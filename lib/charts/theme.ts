/**
 * Shared chart color resolution.
 *
 * Both chart libraries in the app — recharts (SVG) and lightweight-charts
 * (canvas) — draw from the SAME palette by reading it from the design tokens
 * at runtime. A token change in app/globals.css then propagates to every chart
 * with no per-chart edit.
 *
 * `readChartColors()` returns the token values as authored (currently
 * `oklch(...)` strings), which both SVG fills and modern canvas contexts
 * accept. On the server, or before styles have applied, it returns the sRGB
 * fallbacks below — approximations of the OKLCH tokens, only ever visible for
 * a frame.
 */

export interface ChartColors {
  /** Up candle / gain. Maps to `--positive`. */
  positive: string
  /** Down candle / loss. Maps to `--negative`. */
  negative: string
  /** Brand accent — default series, entry levels. Maps to `--primary`. */
  primary: string
  /** Resting-order / informational accent. Maps to `--info`. */
  info: string
  /** Grid lines and axes. Maps to `--border`. */
  border: string
  /** Axis labels and secondary text. Maps to `--muted-foreground`. */
  mutedForeground: string
}

/** sRGB approximations of the OKLCH tokens in app/globals.css. */
const FALLBACK: ChartColors = {
  positive: "#33b077",
  negative: "#e5484a",
  primary: "#e2b43c",
  info: "#5f9fd6",
  border: "#333840",
  mutedForeground: "#9aa1a8",
}

/**
 * Resolves the chart palette from the document's design tokens.
 *
 * Call on the client (inside an effect, or during a client render). On the
 * server it returns {@link FALLBACK}. The app is dark-only, so the result does
 * not need to react to a theme change.
 */
export function readChartColors(): ChartColors {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return FALLBACK
  }

  const styles = getComputedStyle(document.documentElement)
  const read = (token: string, fallback: string): string => {
    const value = styles.getPropertyValue(token).trim()
    return value.length > 0 ? value : fallback
  }

  return {
    positive: read("--positive", FALLBACK.positive),
    negative: read("--negative", FALLBACK.negative),
    primary: read("--primary", FALLBACK.primary),
    info: read("--info", FALLBACK.info),
    border: read("--border", FALLBACK.border),
    mutedForeground: read("--muted-foreground", FALLBACK.mutedForeground),
  }
}
