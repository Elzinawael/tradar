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

/** Return a token class describing a P&L direction. */
export function pnlToneClass(value: number) {
  if (value > 0) return "text-positive"
  if (value < 0) return "text-negative"
  return "text-muted-foreground"
}
