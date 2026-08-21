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
