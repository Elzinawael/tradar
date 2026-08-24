/**
 * Live subscription manager.
 *
 * One provider connection per symbol, shared by every subscriber:
 *
 *   XAUUSD
 *     └── provider connection
 *          ├── client A
 *          ├── client B
 *          └── client C
 *
 * Ten browsers watching the same symbol open ONE upstream connection, not ten.
 * The connection is opened when the first subscriber arrives and closed when
 * the last one leaves, so idle symbols cost nothing.
 *
 * ── SCALING LIMITATION, STATED PLAINLY ────────────────────────────────────
 * State is a module-level map, so sharing is per SERVER PROCESS. Across N
 * instances a symbol may hold up to N upstream connections rather than one,
 * and a tick delivered to one instance is not seen by clients on another.
 * That is acceptable here — Binance's public stream has no per-connection
 * cost, and the alternative is a Redis/pub-sub tier this phase explicitly
 * should not build. If Tradar scales horizontally, the fix is to put a shared
 * bus behind this same interface; nothing calling `subscribe()` changes.
 *
 * No credential ever enters this file: adapters own their own configuration.
 */

import { recordFailure, recordSuccess } from "../health"
import { backoffDelay } from "./backoff"
import type { EligibleProvider } from "../router"
import type {
  LiveDebugInfo,
  LiveDisconnectKind,
  LiveStatus,
  LiveTick,
  LiveTransport,
} from "./types"

/** Give up after this many consecutive reconnect attempts on one symbol. */
const MAX_RECONNECT_ATTEMPTS = 8

export type TickListener = (tick: LiveTick) => void
export type StatusListener = (status: LiveStatus) => void

interface Subscriber {
  id: number
  onTick: TickListener
  onStatus: StatusListener
}

interface SymbolConnection {
  symbol: string
  /** Providers to try, best first. Reused for failover on repeated failure. */
  candidates: EligibleProvider[]
  candidateIndex: number
  subscribers: Map<number, Subscriber>
  status: LiveStatus
  transport: LiveTransport | null
  connectedAt: string | null
  lastTickAt: string | null
  reconnectCount: number
  /**
   * True once the CURRENT candidate has delivered a tick. Distinguishes "this
   * provider never worked" from "it was working and dropped", which want
   * different responses.
   */
  everConnected: boolean
  /**
   * Identifies the current connect attempt. A provider may report a failure
   * through onError AND by throwing, or fire onError twice; without this a
   * single failure would be handled repeatedly and burn through candidates.
   */
  attemptToken: number
  unsubscribe: (() => void) | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  /** Guards against two connect attempts racing for the same symbol. */
  connecting: boolean
  closed: boolean
}

const connections = new Map<string, SymbolConnection>()

/**
 * Latest tick per symbol.
 *
 * Purpose is instant UI initialisation: a new subscriber gets the current
 * price immediately instead of a blank field until the next trade. This is
 * NOT the historical candle cache and is never persisted.
 */
const latestTicks = new Map<string, LiveTick>()

let nextSubscriberId = 1

export function getLatestTick(symbol: string): LiveTick | null {
  return latestTicks.get(symbol) ?? null
}

function setStatus(conn: SymbolConnection, status: LiveStatus): void {
  conn.status = status
  for (const sub of conn.subscribers.values()) sub.onStatus(status)
}

/**
 * Whether a disconnect indicates the PROVIDER is unhealthy.
 *
 * A normal close — including our own unsubscribe — is routine and must not
 * feed the circuit breaker, or ordinary reconnects would take a healthy
 * provider out of rotation.
 */
function isProviderFaultKind(kind: LiveDisconnectKind): boolean {
  return kind === "provider_error" || kind === "rate_limit" || kind === "network"
}

async function connect(conn: SymbolConnection): Promise<void> {
  if (conn.closed || conn.connecting) return
  if (conn.subscribers.size === 0) return

  const candidate = conn.candidates[conn.candidateIndex]
  if (!candidate) {
    setStatus(conn, "unavailable")
    return
  }

  const providerKey = candidate.provider.capabilities.key
  const subscribeLive = candidate.provider.subscribeLive
  if (typeof subscribeLive !== "function") {
    setStatus(conn, "unavailable")
    return
  }

  conn.connecting = true
  const token = ++conn.attemptToken
  setStatus(conn, conn.reconnectCount > 0 ? "reconnecting" : "connecting")

  try {
    const stop = await subscribeLive.call(
      candidate.provider,
      candidate.listing.providerSymbol,
      (tick: LiveTick) => {
        // Re-stamp with the Tradar symbol: downstream must never see the
        // provider's naming, and a client asked for XAUUSD, not XAU/USD.
        const normalised: LiveTick = { ...tick, symbol: conn.symbol }
        conn.lastTickAt = normalised.ts
        latestTicks.set(conn.symbol, normalised)

        if (conn.status !== "live") {
          conn.reconnectCount = 0
          conn.everConnected = true
          conn.connectedAt = new Date().toISOString()
          recordSuccess(providerKey)
          setStatus(conn, "live")
        }

        for (const sub of conn.subscribers.values()) sub.onTick(normalised)
      },
      (kind: LiveDisconnectKind, detail: string) => {
        if (isProviderFaultKind(kind)) {
          // Map stream faults onto the SAME health mechanism historical
          // fetching uses — there is no second breaker.
          recordFailure(
            providerKey,
            kind === "rate_limit" ? "rate_limited" : "network_error",
          )
        }
        if (kind === "auth") recordFailure(providerKey, "auth_error")

        void handleDisconnect(conn, kind, detail, token)
      },
    )

    conn.unsubscribe = stop
    conn.transport = "websocket"
  } catch {
    recordFailure(providerKey, "network_error")
    void handleDisconnect(conn, "network", "Connection failed", token)
  } finally {
    conn.connecting = false
  }
}

async function handleDisconnect(
  conn: SymbolConnection,
  kind: LiveDisconnectKind,
  _detail: string,
  token?: number,
): Promise<void> {
  if (conn.closed) return

  // Ignore a report from a superseded attempt: one failure must advance the
  // state machine once, no matter how many ways the provider signals it.
  if (token !== undefined && token !== conn.attemptToken) return
  // Consume this attempt so any further report for it is ignored.
  conn.attemptToken += 1

  conn.unsubscribe = null

  // Nobody left listening: stay closed rather than reconnecting for no one.
  if (conn.subscribers.size === 0) return

  // A clean close that we did not initiate still warrants reconnecting, but
  // it is not a fault, so the provider is not rotated away from.
  if (kind === "auth" || kind === "invalid_subscription") {
    // Credentials or a bad symbol will not fix themselves by retrying the same
    // provider; move to the next candidate if one exists.
    conn.candidateIndex += 1
    conn.reconnectCount = 0
    if (conn.candidateIndex >= conn.candidates.length) {
      setStatus(conn, "unavailable")
      return
    }
  } else if (!conn.everConnected) {
    // The candidate never produced a stream at all. Retrying it on a backoff
    // would delay the customer for a provider that has shown no sign of
    // working, so rotate immediately — that is what having candidates is for.
    // A provider that HAS worked is treated differently below.
    conn.candidateIndex += 1
    conn.reconnectCount = 0
    if (conn.candidateIndex >= conn.candidates.length) {
      setStatus(conn, "unavailable")
      return
    }
  } else {
    conn.reconnectCount += 1
    if (conn.reconnectCount > MAX_RECONNECT_ATTEMPTS) {
      // A previously healthy provider has now failed repeatedly; try the next
      // before giving up entirely.
      conn.candidateIndex += 1
      conn.reconnectCount = 0
      conn.everConnected = false
      if (conn.candidateIndex >= conn.candidates.length) {
        setStatus(conn, "disconnected")
        return
      }
    }
  }

  setStatus(conn, "reconnecting")

  // reconnectCount is 0 immediately after rotating to a new candidate, so a
  // failover attempt starts promptly rather than waiting out a backoff earned
  // by a different provider.
  const delay = conn.reconnectCount === 0 ? 0 : backoffDelay(conn.reconnectCount)
  conn.reconnectTimer = setTimeout(() => {
    conn.reconnectTimer = null
    void connect(conn)
  }, delay)
}

export interface SubscribeHandle {
  /** Removes this subscriber, closing the upstream connection if it was last. */
  unsubscribe: () => void
  /** Latest known price, for immediate UI paint. */
  latest: LiveTick | null
}

/**
 * Adds a subscriber for a symbol, opening the upstream connection if needed.
 *
 * `candidates` comes from resolveLiveProviders(), so provider choice and
 * symbol translation have already happened server-side. Passing them in keeps
 * this file free of registry and routing concerns, and testable with mocks.
 */
export function subscribe(params: {
  symbol: string
  candidates: EligibleProvider[]
  onTick: TickListener
  onStatus: StatusListener
}): SubscribeHandle {
  const { symbol, candidates, onTick, onStatus } = params

  let conn = connections.get(symbol)

  if (!conn) {
    conn = {
      symbol,
      candidates,
      candidateIndex: 0,
      subscribers: new Map(),
      status: "connecting",
      transport: null,
      connectedAt: null,
      lastTickAt: null,
      reconnectCount: 0,
      everConnected: false,
      attemptToken: 0,
      unsubscribe: null,
      reconnectTimer: null,
      connecting: false,
      closed: false,
    }
    connections.set(symbol, conn)
  }

  const id = nextSubscriberId++
  conn.subscribers.set(id, { id, onTick, onStatus })

  // Tell the newcomer where things stand instead of leaving it blank.
  onStatus(conn.status)

  // Only the first subscriber triggers a connection; the rest join the
  // existing one. This is what keeps N browsers to one upstream socket.
  if (conn.subscribers.size === 1) {
    void connect(conn)
  }

  const connection = conn

  return {
    latest: latestTicks.get(symbol) ?? null,
    unsubscribe: () => {
      connection.subscribers.delete(id)
      if (connection.subscribers.size > 0) return

      // Last one out closes the upstream connection, so an unwatched symbol
      // costs nothing.
      connection.closed = true
      if (connection.reconnectTimer) {
        clearTimeout(connection.reconnectTimer)
        connection.reconnectTimer = null
      }
      try {
        connection.unsubscribe?.()
      } catch {
        // Already gone.
      }
      connections.delete(symbol)
    },
  }
}

/** Admin diagnostics for one symbol. Never contains credentials. */
export function getDebugInfo(symbol: string): LiveDebugInfo | null {
  const conn = connections.get(symbol)
  if (!conn) return null

  return {
    symbol: conn.symbol,
    provider:
      conn.candidates[conn.candidateIndex]?.provider.capabilities.key ?? null,
    transport: conn.transport,
    status: conn.status,
    connectedAt: conn.connectedAt,
    lastTickAt: conn.lastTickAt,
    reconnectCount: conn.reconnectCount,
    subscriberCount: conn.subscribers.size,
  }
}

/** Active symbol count. Diagnostics and tests. */
export function activeConnectionCount(): number {
  return connections.size
}

/** Clears all live state. Test support only. */
export function resetLiveState(): void {
  for (const conn of connections.values()) {
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
    try {
      conn.unsubscribe?.()
    } catch {
      // ignore
    }
  }
  connections.clear()
  latestTicks.clear()
}
