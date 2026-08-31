/**
 * Pure numeric-field logic for the Smart Input family.
 *
 * Framework-agnostic and side-effect free so it can be unit tested directly and
 * reused by any control. It handles ONLY presentation-level number handling —
 * parsing what the user typed, formatting it back, stepping, clamping,
 * precision. It contains no trading maths: risk, position size and level
 * validation stay in lib/trade-math.ts and lib/replay-engine.ts.
 */

/** Clamp a requested decimal precision into a sane, supported range. */
export function normalizePrecision(precision: number): number {
  if (!Number.isFinite(precision)) return 2
  return Math.max(0, Math.min(12, Math.trunc(precision)))
}

/** Number of decimal places a value is written with (handles 1e-5 notation). */
export function countDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0
  const s = String(value)
  const exp = s.match(/e-(\d+)$/i)
  if (exp) {
    const dotDecimals = s.includes(".") ? s.split("e")[0].split(".")[1].length : 0
    return Number(exp[1]) + dotDecimals
  }
  const dot = s.indexOf(".")
  return dot === -1 ? 0 : s.length - dot - 1
}

/** Round to `precision` decimals without binary-float artefacts. */
export function roundToPrecision(value: number, precision: number): number {
  const p = normalizePrecision(precision)
  const factor = 10 ** p
  return Math.round((value + Number.EPSILON) * factor) / factor
}

/**
 * Effective step: an explicit positive step wins, otherwise it is derived from
 * the precision (precision 5 → 0.00001, precision 2 → 0.01, precision 0 → 1).
 */
export function resolveStep(precision: number, step?: number | null): number {
  if (typeof step === "number" && Number.isFinite(step) && step > 0) return step
  return 10 ** -normalizePrecision(precision)
}

/**
 * Restrict a raw input string to a form-submittable number.
 *
 * Strips grouping separators, currency symbols and stray characters, keeps a
 * single decimal point, and (optionally) a single leading minus. The result is
 * always safe to place in a form field whose value the server parses with
 * `Number()` — the same contract the previous `<input type="number">` had.
 */
export function sanitizeNumericInput(raw: string, allowNegative = false): string {
  let s = raw.replace(allowNegative ? /[^0-9.-]/g : /[^0-9.]/g, "")

  const firstDot = s.indexOf(".")
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "")
  }

  if (allowNegative) {
    const negative = s.startsWith("-")
    s = (negative ? "-" : "") + s.replace(/-/g, "")
  } else {
    s = s.replace(/-/g, "")
  }

  return s
}

/** Parse a (sanitized) input string to a finite number, or null. */
export function parseNumeric(raw: string): number | null {
  const s = raw.trim()
  if (s === "" || s === "." || s === "-" || s === "-." || s === "+") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Plain, ungrouped, fixed-decimal string — safe for a form field. */
export function toPlainString(value: number, precision: number): string {
  const p = normalizePrecision(precision)
  return roundToPrecision(value, p).toFixed(p)
}

/** Grouped, fixed-decimal string — for read-only display (reset chip, ticks). */
export function toGroupedString(value: number, precision: number): string {
  const p = normalizePrecision(precision)
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: p,
    maximumFractionDigits: p,
  }).format(value)
}

/**
 * Normalize a raw string on blur WITHOUT ever losing information: trailing
 * zeros are added up to `precision`, but a value the user typed with MORE
 * decimals than `precision` is kept exactly. This is what lets the field show
 * "5025.00" after "5025" while never truncating "1.10502" to "1.11".
 */
export function padToPrecision(raw: string, precision: number): string {
  const n = parseNumeric(raw)
  if (n === null) return raw
  const target = Math.max(normalizePrecision(precision), countDecimals(n))
  return n.toFixed(target)
}

/** Clamp to [min, max] when finite bounds are supplied. */
export function clampToBounds(
  value: number,
  min?: number | null,
  max?: number | null,
): number {
  let v = value
  if (typeof min === "number" && Number.isFinite(min) && v < min) v = min
  if (typeof max === "number" && Number.isFinite(max) && v > max) v = max
  return v
}

/**
 * One step in `direction`, from `base` (or `fallback`/`min`/0 when empty),
 * snapped to a decimal grid that is never coarser than the base value already
 * is, then clamped to bounds. `multiplier` covers Shift+Arrow / Page keys.
 */
export function stepValue(params: {
  base: number | null
  direction: 1 | -1
  step: number
  precision: number
  multiplier?: number
  fallback?: number | null
  min?: number | null
  max?: number | null
}): number {
  const {
    base,
    direction,
    step,
    precision,
    multiplier = 1,
    fallback = null,
    min,
    max,
  } = params

  const start =
    base ??
    fallback ??
    (typeof min === "number" && Number.isFinite(min) ? min : 0)

  const decimals = Math.max(
    normalizePrecision(precision),
    countDecimals(step),
    countDecimals(start),
  )

  const next = roundToPrecision(start + direction * step * multiplier, decimals)
  return clampToBounds(next, min, max)
}

/** Do two values represent the same number at the given precision? */
export function equalAtPrecision(
  a: number | null,
  b: number | null,
  precision: number,
): boolean {
  if (a === null || b === null) return false
  return roundToPrecision(a, precision) === roundToPrecision(b, precision)
}

/**
 * Guess a display precision from sample values (e.g. recent candle closes),
 * used only as a fallback when an instrument carries no stored precision.
 */
export function inferPrecisionFromSamples(
  values: readonly number[],
  fallback = 2,
): number {
  let max = 0
  let seen = false
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    seen = true
    const d = countDecimals(v)
    if (d > max) max = d
  }
  return seen ? max : fallback
}

/**
 * A contextual slider window around a reference price. Explicit bounds win;
 * otherwise the window is `reference ± rangePercent%`. Returns null when
 * neither a usable reference nor an explicit range is available (the slider is
 * then simply not rendered).
 */
export function resolveSliderRange(params: {
  reference: number | null
  precision: number
  explicitMin?: number | null
  explicitMax?: number | null
  rangePercent?: number
}): { min: number; max: number } | null {
  const { reference, precision, explicitMin, explicitMax, rangePercent = 0.5 } =
    params

  const em =
    typeof explicitMin === "number" && Number.isFinite(explicitMin)
      ? explicitMin
      : undefined
  const eM =
    typeof explicitMax === "number" && Number.isFinite(explicitMax)
      ? explicitMax
      : undefined

  if (em !== undefined && eM !== undefined) {
    return eM > em ? { min: em, max: eM } : null
  }

  if (reference === null || !Number.isFinite(reference) || reference === 0) {
    return null
  }

  const span = Math.abs(reference) * (rangePercent / 100)
  const min = em ?? roundToPrecision(reference - span, precision)
  const max = eM ?? roundToPrecision(reference + span, precision)
  return max > min ? { min, max } : null
}
