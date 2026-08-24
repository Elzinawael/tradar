import { NextRequest } from "next/server"
import { getInstrumentBySymbol } from "@/lib/market-data/registry"
import { getCurrentUser } from "@/lib/supabase/server"
import { getLatestTick, subscribe } from "@/lib/market-data/live/manager"
import { resolveLiveProviders } from "@/lib/market-data/router"
import {
  LIVE_UNAVAILABLE_MESSAGES,
  type LiveUnavailableReason,
} from "@/lib/market-data/live/types"
import type { LiveStatus, LiveTick } from "@/lib/market-data/live/types"

/**
 * Live market data stream (Server-Sent Events).
 *
 * ── WHY SSE ───────────────────────────────────────────────────────────────
 * The data flows one way — server to browser — and the client never needs to
 * push anything back over the same channel. SSE gives that with a plain Next
 * route handler, automatic browser-side reconnection, and no extra
 * infrastructure. A WebSocket would add a bidirectional transport, and in a
 * serverless deployment usually a separate always-on process, to carry
 * traffic that only ever travels in one direction.
 *
 * ── WHAT THE CLIENT CANNOT DO ─────────────────────────────────────────────
 * The browser sends a Tradar symbol and nothing else. It cannot name a
 * provider, cannot supply a provider symbol, cannot set a priority, and never
 * sees an API key: the symbol is resolved against the registry and the
 * provider is chosen by the router, server-side. Credentials stay in the
 * provider adapters and are never serialised into an event.
 *
 * ── SCALING LIMIT, STATED PLAINLY ─────────────────────────────────────────
 * The subscription manager is in-process. Several browsers watching the same
 * symbol on one server share a single provider connection, which is the point.
 * Across several instances each keeps its own, so provider connections scale
 * with instances rather than with users. That is fine at this size; beyond it
 * the fix is a shared fan-out process, and nothing in this route changes.
 */

// A stream must not be prerendered or cached.
export const dynamic = "force-dynamic"

/** Comment line keeps intermediaries from closing an idle connection. */
const HEARTBEAT_MS = 25_000

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const user = await getCurrentUser()
  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { symbol: raw } = await context.params
  const symbol = raw.trim().toUpperCase()

  // The symbol must exist in the registry: a client cannot invent one and have
  // Tradar open a provider connection for it.
  const instrument = await getInstrumentBySymbol(symbol)
  if (!instrument) {
    return new Response("Unknown instrument", { status: 404 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          )
        } catch {
          // The client went away between the check and the write.
          closed = true
        }
      }

      // Seed from the latest-price cache so a new subscriber renders a price
      // immediately instead of waiting for the next tick, which on a quiet
      // instrument could be a while.
      const cached = getLatestTick(symbol)
      if (cached) send("tick", cached)

      // Provider choice and symbol translation happen here, server-side. The
      // manager never sees a registry or a router, and the browser never sees
      // a provider.
      const resolution = resolveLiveProviders(
        instrument,
        instrument.listings,
      )

      if (resolution.eligible.length === 0) {
        // No configured provider STREAMS this instrument. Say so explicitly
        // rather than quietly serving historical data dressed as live.
        // The router speaks the historical eligibility taxonomy; the customer
        // needs a live-specific message. Mapped explicitly rather than cast,
        // so a new routing reason cannot silently produce "undefined".
        const reason: LiveUnavailableReason =
          resolution.reason === "provider_not_configured"
            ? "provider_not_configured"
            : resolution.reason === "instrument_inactive"
              ? "instrument_unknown"
              : "no_realtime_provider"

        send("status", {
          status: "unavailable",
          message: LIVE_UNAVAILABLE_MESSAGES[reason],
        })
        closed = true
        controller.close()
        return
      }

      const subscription = subscribe({
        symbol,
        candidates: resolution.eligible,
        onTick: (tick: LiveTick) => send("tick", tick),
        onStatus: (status: LiveStatus) => send("status", { status }),
      })

      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"))
        } catch {
          closed = true
        }
      }, HEARTBEAT_MS)

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        // Releases this subscriber. The provider connection closes only when
        // the last one leaves.
        subscription.unsubscribe()
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      }

      request.signal.addEventListener("abort", cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Stops nginx-style proxies buffering the stream into uselessness.
      "X-Accel-Buffering": "no",
    },
  })
}
