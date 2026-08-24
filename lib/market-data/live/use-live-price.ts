"use client"

import { useEffect, useRef, useState } from "react"
import type { LiveStatus, LiveTick } from "@/lib/market-data/live/types"

export interface UseLivePriceResult {
  tick: LiveTick | null
  status: LiveStatus
  /** Customer-safe explanation when status is "unavailable". */
  message: string | null
}

/**
 * Subscribes to the live price stream for one Tradar symbol.
 *
 * The hook sends only the symbol; the server resolves the provider and its
 * symbol, so nothing here can name a vendor or leak a key.
 *
 * Lifecycle, which is where this kind of hook usually goes wrong:
 *
 *   * The effect keys on `symbol`, so switching instrument tears the old
 *     EventSource down before opening the new one — no orphaned stream quietly
 *     delivering the previous symbol's prices.
 *   * Unmount closes the connection, releasing the server-side subscriber and,
 *     if it was the last, the upstream provider connection.
 *   * A generation counter guards every state write, so a message that arrives
 *     from a closing connection after a symbol change cannot overwrite the new
 *     symbol's price.
 *
 * Reconnection is deliberately NOT reimplemented here. EventSource reconnects
 * on its own, and the server-side manager owns backoff and provider failover;
 * adding a third retry loop in the browser would fight both.
 *
 * Passing `null` disables the subscription entirely — used when live data is
 * not wanted, rather than opening a stream and ignoring it.
 */
export function useLivePrice(symbol: string | null): UseLivePriceResult {
  const [state, setState] = useState<{
    tick: LiveTick | null
    status: LiveStatus
    message: string | null
  }>({ tick: null, status: "connecting", message: null })

  const generation = useRef(0)

  useEffect(() => {
    // Nothing to subscribe to. Handled by the derived return below rather than
    // by writing state from inside the effect.
    if (!symbol) return

    const mine = ++generation.current
    const isCurrent = () => generation.current === mine

    const source = new EventSource(
      `/api/live/${encodeURIComponent(symbol)}`,
    )

    source.addEventListener("tick", (event) => {
      if (!isCurrent()) return
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as LiveTick
        setState({ tick: parsed, status: "live", message: null })
      } catch {
        // A malformed frame is dropped rather than crashing the subscription.
      }
    })

    source.addEventListener("status", (event) => {
      if (!isCurrent()) return
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as {
          status: LiveStatus
          message?: string
        }
        setState((prev) => ({
          ...prev,
          status: parsed.status,
          message: parsed.message ?? null,
        }))
        if (parsed.status === "unavailable") source.close()
      } catch {
        // Ignore unparseable status frames.
      }
    })

    source.onerror = () => {
      if (!isCurrent()) return
      // EventSource retries by itself; surface the state rather than acting.
      setState((prev) => ({
        ...prev,
        status:
          source.readyState === EventSource.CLOSED
            ? "disconnected"
            : "reconnecting",
      }))
    }

    return () => {
      // Invalidate in-flight handlers before closing, so a late frame from
      // this connection cannot touch the next symbol's state.
      generation.current += 1
      source.close()
    }
  }, [symbol])

  // Derived, so disabling the hook needs no effect write.
  if (!symbol) {
    return { tick: null, status: "disconnected", message: null }
  }

  return state
}
