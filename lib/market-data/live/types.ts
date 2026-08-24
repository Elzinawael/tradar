/**
 * Live market data model.
 *
 * Deliberately separate from the historical types: a tick is not a candle, and
 * conflating them is how live prices end up corrupting stored history. Live
 * data is ephemeral and never written to public.candles by this layer.
 */

/**
 * A normalised price update.
 *
 * `price` is the only guaranteed field. Providers differ in what they publish
 * — a trade stream carries no bid/ask, a quote stream carries no volume — and
 * inventing those values would be worse than admitting they are absent, so
 * everything else is nullable.
 */
export interface LiveTick {
  /** Tradar symbol, never the provider's. */
  symbol: string
  /** Provider key. Server-side diagnostics only; not shown to customers. */
  provider: string
  /** ISO 8601, normalised from whatever the provider sends. */
  ts: string
  price: number
  bid: number | null
  ask: number | null
  volume: number | null
}

export type LiveStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "disconnected"
  | "unavailable"

/**
 * How a provider actually delivers updates.
 *
 * This distinction is recorded honestly: a polled source is NOT streaming, and
 * labelling it as such would misrepresent both latency and cost. No adapter in
 * this phase polls, but the type exists so one can be added without the
 * difference being quietly lost.
 */
export type LiveTransport = "websocket" | "server-polled"

export type LiveUnavailableReason =
  | "no_realtime_provider"
  | "instrument_unknown"
  | "provider_not_configured"

export const LIVE_UNAVAILABLE_MESSAGES: Record<LiveUnavailableReason, string> = {
  no_realtime_provider: "Live prices are not available for this instrument.",
  instrument_unknown: "That instrument is not available.",
  provider_not_configured: "Live prices are not configured on this server.",
}

/** Admin diagnostics. Contains no credentials, no URLs, no payloads. */
export interface LiveDebugInfo {
  symbol: string
  provider: string | null
  transport: LiveTransport | null
  status: LiveStatus
  connectedAt: string | null
  lastTickAt: string | null
  reconnectCount: number
  subscriberCount: number
}

/**
 * Why a live connection ended.
 *
 * A normal close is not a fault. Treating every disconnect as provider
 * ill-health would trip the circuit breaker during routine reconnects and take
 * a healthy provider out of rotation.
 */
export type LiveDisconnectKind =
  | "normal"
  | "network"
  | "provider_error"
  | "auth"
  | "rate_limit"
  | "invalid_subscription"
