"use client"

import { useLivePrice } from "@/lib/market-data/live/use-live-price"
import { cn } from "@/lib/utils"
import type { LiveStatus } from "@/lib/market-data/live/types"

/**
 * Live price for one instrument.
 *
 * Shows a price only when one has actually arrived. There is no placeholder
 * number and no historical close standing in for a live quote — an empty state
 * is honest, whereas a stale price presented as live is not.
 *
 * The provider is never named: a customer sees status, not plumbing.
 */

const STATUS_LABEL: Record<LiveStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
  unavailable: "Live data unavailable",
}

const STATUS_TONE: Record<LiveStatus, string> = {
  connecting: "text-muted-foreground",
  live: "text-positive",
  reconnecting: "text-primary",
  disconnected: "text-muted-foreground",
  unavailable: "text-muted-foreground",
}

export function LivePrice({
  symbol,
  displayName,
  pricePrecision = 2,
  className,
}: {
  symbol: string
  displayName?: string
  pricePrecision?: number
  className?: string
}) {
  const { tick, status, message } = useLivePrice(symbol)

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{symbol}</span>
        {displayName && (
          <span className="text-xs text-muted-foreground">{displayName}</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="font-mono text-2xl tabular-nums">
          {tick
            ? tick.price.toFixed(pricePrecision)
            : /* No price yet: a dash, never a fabricated or stale number. */
              "—"}
        </span>

        <span className={cn("flex items-center gap-1.5 text-xs", STATUS_TONE[status])}>
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              status === "live" && "animate-pulse bg-positive",
              status === "connecting" && "bg-muted-foreground",
              status === "reconnecting" && "animate-pulse bg-primary",
              status === "disconnected" && "bg-muted-foreground",
              status === "unavailable" && "bg-muted-foreground",
            )}
          />
          {STATUS_LABEL[status]}
        </span>
      </div>

      {tick && (
        <span className="text-[10px] text-muted-foreground">
          Updated {new Date(tick.ts).toLocaleTimeString()}
        </span>
      )}

      {status === "unavailable" && message && (
        <span className="text-xs text-muted-foreground">{message}</span>
      )}
    </div>
  )
}
