/**
 * Stored-coverage arithmetic.
 *
 * Pure helpers that decide which parts of a requested range still need
 * fetching, so an already-downloaded span is never requested from a provider
 * twice. Kept free of I/O so the gap logic is unit testable.
 */

export interface StoredRange {
  first: string | null
  last: string | null
  candleCount: number
}

export interface MissingRange {
  from: Date
  to: Date
}

/**
 * Which sub-ranges of [from, to] are not covered by stored data.
 *
 * Coverage is tracked as the stored min/max rather than as a per-bar bitmap.
 * That is deliberate: markets have legitimate gaps — weekends, holidays,
 * halts — so "no bar at 03:00 Sunday" does not mean data is missing, and a
 * per-bar model would re-request those forever. The trade-off is that an
 * interior hole left by a partial import is not detected; re-importing the
 * range repairs it, and the primary key makes that idempotent.
 *
 * Returns:
 *   * the whole range when nothing is stored
 *   * nothing when the stored span already covers the request
 *   * one or two edge ranges when the request extends before or after storage
 */
export function findMissingRanges(
  stored: StoredRange,
  from: Date,
  to: Date,
): MissingRange[] {
  const start = from.getTime()
  const end = to.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []

  if (stored.candleCount === 0 || !stored.first || !stored.last) {
    return [{ from, to }]
  }

  const storedFirst = new Date(stored.first).getTime()
  const storedLast = new Date(stored.last).getTime()
  if (!Number.isFinite(storedFirst) || !Number.isFinite(storedLast)) {
    return [{ from, to }]
  }

  const missing: MissingRange[] = []

  // Requested range starts before anything stored.
  if (start < storedFirst) {
    missing.push({ from: new Date(start), to: new Date(Math.min(storedFirst, end)) })
  }

  // Requested range continues past the end of storage.
  if (end > storedLast) {
    missing.push({ from: new Date(Math.max(storedLast, start)), to: new Date(end) })
  }

  return missing.filter((r) => r.to.getTime() > r.from.getTime())
}

/** True when stored data already spans the whole request. */
export function isFullyCovered(
  stored: StoredRange,
  from: Date,
  to: Date,
): boolean {
  return findMissingRanges(stored, from, to).length === 0
}

// ---------------------------------------------------------------------------
// Explicit coverage spans (candle_coverage)
//
// The outer min/max model above cannot see an interior hole. `candle_coverage`
// records every range that has actually been requested from a source; these
// pure helpers turn those (possibly overlapping) spans into the gaps that
// still need fetching.
// ---------------------------------------------------------------------------

/** A half-open time span in epoch milliseconds. */
export interface Span {
  start: number
  end: number
}

/** Sorts, drops empties, and merges overlapping or touching spans. */
export function mergeSpans(spans: Span[]): Span[] {
  const clean = spans
    .filter(
      (s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start,
    )
    .sort((a, b) => a.start - b.start)

  const merged: Span[] = []
  for (const span of clean) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

/**
 * The parts of `requested` not covered by `covered`.
 *
 * `covered` need not be pre-merged. `tolerance` (ms) closes a hairline gap
 * caused by a range boundary landing a fraction before a stored bar.
 */
export function subtractSpans(
  requested: Span,
  covered: Span[],
  tolerance = 0,
): Span[] {
  if (!(requested.end > requested.start)) return []

  const gaps: Span[] = []
  let cursor = requested.start

  for (const span of mergeSpans(covered)) {
    if (span.end <= cursor) continue
    if (span.start >= requested.end) break

    if (span.start - cursor > tolerance) {
      gaps.push({ start: cursor, end: Math.min(span.start, requested.end) })
    }
    cursor = Math.max(cursor, span.end)
    if (cursor >= requested.end) break
  }

  if (requested.end - cursor > tolerance) {
    gaps.push({ start: cursor, end: requested.end })
  }
  return gaps
}

/** True when the coverage spans already contain the whole requested span. */
export function spansCover(
  requested: Span,
  covered: Span[],
  tolerance = 0,
): boolean {
  return subtractSpans(requested, covered, tolerance).length === 0
}

/** Coverage rows (from candle_coverage) → the still-missing sub-ranges. */
export function missingRangesFromSpans(
  rows: { range_start: string; range_end: string }[],
  from: Date,
  to: Date,
): MissingRange[] {
  const covered: Span[] = rows.map((r) => ({
    start: new Date(r.range_start).getTime(),
    end: new Date(r.range_end).getTime(),
  }))
  // A one-minute tolerance so a request bound that sits just inside a stored
  // span is not treated as a sliver gap.
  return subtractSpans(
    { start: from.getTime(), end: to.getTime() },
    covered,
    60_000,
  ).map((g) => ({ from: new Date(g.start), to: new Date(g.end) }))
}
