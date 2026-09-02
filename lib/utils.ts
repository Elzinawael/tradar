import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a number as USD currency. */
export function formatCurrency(
  value: number,
  opts: { signed?: boolean; compact?: boolean } = {},
) {
  const { signed = false, compact = false } = opts
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    notation: compact ? "compact" : "standard",
  }).format(Math.abs(value))
  if (!signed) return value < 0 ? `-${formatted}` : formatted
  return `${value >= 0 ? "+" : "-"}${formatted}`
}

/** Format a percentage value (expects 0–100). */
export function formatPercent(value: number, fractionDigits = 1) {
  return `${value.toFixed(fractionDigits)}%`
}

/**
 * Format an instant as a medium date + short time, pinned to `en-US` and UTC.
 *
 * Candle and replay cursor timestamps are UTC market time. Pinning both the
 * locale and the time zone makes the output identical on the server and in the
 * browser, so it is safe to render inside a Client Component without a
 * hydration mismatch, and it lines up with the chart's UTC time axis.
 */
export function formatMarketDateTime(value: string | number | Date) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  })
}

/** Date-only variant of {@link formatMarketDateTime}. */
export function formatMarketDate(value: string | number | Date) {
  return new Date(value).toLocaleDateString("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  })
}

/** Return a token class describing a P&L direction. */
export function pnlToneClass(value: number) {
  if (value > 0) return "text-positive"
  if (value < 0) return "text-negative"
  return "text-muted-foreground"
}
