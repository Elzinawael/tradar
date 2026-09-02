/**
 * Shared chart color resolution.
 *
 * Both chart libraries in the app — recharts (SVG) and lightweight-charts
 * (canvas) — draw from the SAME palette by reading it from the design tokens
 * at runtime. A token change in app/globals.css then propagates to every chart
 * with no per-chart edit.
 *
 * The tokens in app/globals.css are authored as `oklch(...)`. SVG fills accept
 * that verbatim, but lightweight-charts 5.2.1 ships its own color parser that
 * only understands hex, `rgb()/rgba()`, `hsl()/hsla()` and the named CSS
 * colors — an `oklch(...)` (or `oklab()/lab()/lch()/color()`) string makes it
 * throw `Failed to parse color: oklch(...)` while the chart mounts, which is
 * the production Replay crash this module now guards against.
 *
 * `readChartColors()` therefore normalizes every resolved token through the
 * browser's own color engine (rasterizing one pixel on a canvas 2D context and
 * reading the bytes back) into the sRGB `rgb()` / `rgba()` form that every
 * chart library accepts. On the server, before styles have applied, or if
 * normalization is somehow unavailable, it falls back to the sRGB
 * approximations below — only ever visible for a frame.
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
 * Colors lightweight-charts' parser already accepts, so they can pass through
 * untouched when the canvas normalizer is unavailable (non-DOM environments).
 * Deliberately narrow: hex, `rgb()/rgba()`, `hsl()/hsla()` and `transparent`.
 */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent$)/i

/**
 * Lazily-created, reused canvas 2D context used purely as a color parser.
 * `undefined` = not yet attempted, `null` = unavailable (SSR / no DOM).
 */
let parserContext: CanvasRenderingContext2D | null | undefined

function getParserContext(): CanvasRenderingContext2D | null {
  if (parserContext !== undefined) return parserContext
  parserContext = null
  try {
    if (typeof document !== "undefined") {
      parserContext = document
        .createElement("canvas")
        .getContext("2d", { willReadFrequently: true })
    }
  } catch {
    parserContext = null
  }
  return parserContext
}

/**
 * Normalizes any browser-supported CSS color into an sRGB `rgb()` / `rgba()`
 * string, which lightweight-charts can always parse.
 *
 * It does NOT rely on `canvas.fillStyle` serialization: modern engines read a
 * wide-gamut value such as `lab(...)` / `oklch(...)` / `color(...)` straight
 * back in that same syntax (which is exactly what still crashed the chart —
 * `getComputedStyle` returns the tokens as `lab(...)` in current Chrome). It
 * instead rasterizes one pixel and reads the 8-bit sRGB bytes back, so the
 * result is always plain `rgb()` / `rgba()`.
 *
 * Returns `null` when the value is not a color the browser can parse, or when
 * no canvas context is available (so the caller can fall back).
 */
function canvasNormalize(value: string): string | null {
  const ctx = getParserContext()
  if (!ctx) return null

  try {
    // Validity check: assigning an unparseable value to `fillStyle` is a
    // no-op, so two different seeds stay different; a parseable value (in any
    // syntax) collapses both to the same serialization.
    ctx.fillStyle = "#000"
    ctx.fillStyle = value
    const fromBlack = ctx.fillStyle
    ctx.fillStyle = "#fff"
    ctx.fillStyle = value
    if (ctx.fillStyle !== fromBlack) return null

    // Force an sRGB read: paint the pixel and sample it back as bytes.
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return a === 255
      ? `rgb(${r}, ${g}, ${b})`
      : `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(4))})`
  } catch {
    return null
  }
}

/**
 * Resolves a single token value to a color lightweight-charts can parse.
 *
 * Exported for tests. `normalize` is injectable so the browser-only canvas
 * path can be exercised without a DOM.
 */
export function normalizeChartColor(
  value: string,
  fallback: string,
  normalize: (input: string) => string | null = canvasNormalize,
): string {
  const trimmed = value.trim()
  if (!trimmed) return fallback

  // Only trust a normalized result that is itself in a lightweight-charts-safe
  // syntax — a normalizer that hands back `lab(...)` / `oklch(...)` is no use.
  const normalized = normalize(trimmed)?.trim()
  if (normalized && SAFE_COLOR.test(normalized)) return normalized

  // No canvas (non-DOM), or nothing safe came back: let already-safe syntaxes
  // through, fall back on the ones lightweight-charts would choke on
  // (oklch/oklab/lab/lch/color/…).
  return SAFE_COLOR.test(trimmed) ? trimmed : fallback
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
    const raw = styles.getPropertyValue(token).trim()
    return normalizeChartColor(raw || fallback, fallback)
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
