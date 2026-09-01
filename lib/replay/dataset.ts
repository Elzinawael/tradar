/**
 * Replay dataset assessment.
 *
 * Pure helpers that answer one question the current pipeline never asked: does
 * the candle data behind a replay actually cover the requested window, or does
 * it have holes that will make the replay skip time silently?
 *
 * Kept free of I/O so it can be unit tested and reused by the replay page, the
 * replay player and any future "verify before you start" check in
 * createReplaySession.
 */

import { TIMEFRAME_MINUTES, type Candle, type Timeframe } from "../candles.ts"

export interface DataGap {
  /** Timestamp of the last present bar before the gap. */
  afterTs: string
  /** Timestamp of the first present bar after the gap. */
  beforeTs: string
  /** Whole bars missing between them. */
  missingBars: number
  /** Wall-clock hours the gap spans. */
  hours: number
}

export interface CoverageReport {
  timeframe: Timeframe
  rangeStart: string
  rangeEnd: string
  /** Bars actually present within [rangeStart, rangeEnd]. */
  actualBars: number
  /**
   * Bars a fully continuous (24/7) feed would contain for the range. Real
   * markets have weekends and holidays, so `ratio` well below 1 is normal for
   * non-crypto — it is the interior gaps, not the ratio, that indicate a
   * broken fetch.
   */
  continuousBars: number
  ratio: number
  /** First and last bar timestamps within the range, or null when empty. */
  firstTs: string | null
  lastTs: string | null
  /**
   * The requested range starts before / ends after the stored data. These are
   * edge shortfalls a re-fetch can repair.
   */
  missingHead: boolean
  missingTail: boolean
  /** Suspicious interior gaps (see {@link findInteriorGaps}). */
  gaps: DataGap[]
  /** No interior gaps and no meaningful head/tail shortfall. */
  complete: boolean
}

const HOUR_MS = 3_600_000

/**
 * Interior gaps that look like a broken fetch rather than a market closure.
 *
 * A gap is reported when MORE than `toleranceBars` consecutive bars are missing
 * AND the gap is shorter than `maxClosureHours` — long enough to be a real
 * hole, short enough not to be a normal weekend. It is a heuristic, deliberately
 * conservative: a flagged gap is worth a warning, an unflagged one is not a
 * guarantee of completeness.
 */
export function findInteriorGaps(
  candles: Candle[],
  timeframe: Timeframe,
  opts: { toleranceBars?: number; maxClosureHours?: number } = {},
): DataGap[] {
  const { toleranceBars = 3, maxClosureHours = 74 } = opts
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000
  if (barMs <= 0 || candles.length < 2) return []

  const sorted = [...candles].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  )

  const gaps: DataGap[] = []
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = new Date(sorted[i - 1].ts).getTime()
    const curr = new Date(sorted[i].ts).getTime()
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || curr <= prev) continue

    const spanMs = curr - prev
    const missingBars = Math.round(spanMs / barMs) - 1
    if (missingBars <= toleranceBars) continue

    const hours = spanMs / HOUR_MS
    if (hours >= maxClosureHours) continue // treat as a market closure

    gaps.push({
      afterTs: sorted[i - 1].ts,
      beforeTs: sorted[i].ts,
      missingBars,
      hours: Math.round(hours * 10) / 10,
    })
  }
  return gaps
}

/**
 * Full coverage report for a replay's dataset.
 *
 * `candles` should already be the bars stored for the replay's symbol,
 * timeframe and range. `complete` is true only when there is no interior gap
 * and the stored span reaches within one bar of both range edges.
 */
export function assessCoverage(
  candles: Candle[],
  range: { start: string; end: string },
  timeframe: Timeframe,
): CoverageReport {
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000
  const startMs = new Date(range.start).getTime()
  const endMs = new Date(range.end).getTime()

  const within = candles.filter((c) => {
    const t = new Date(c.ts).getTime()
    return Number.isFinite(t) && t >= startMs && t <= endMs
  })
  const sorted = [...within].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  )

  const firstTs = sorted[0]?.ts ?? null
  const lastTs = sorted[sorted.length - 1]?.ts ?? null

  const continuousBars =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && barMs > 0
      ? Math.max(1, Math.round((endMs - startMs) / barMs))
      : 0

  const gaps = findInteriorGaps(sorted, timeframe)

  const missingHead =
    firstTs === null || new Date(firstTs).getTime() - startMs > 2 * barMs
  const missingTail =
    lastTs === null || endMs - new Date(lastTs).getTime() > 2 * barMs

  return {
    timeframe,
    rangeStart: range.start,
    rangeEnd: range.end,
    actualBars: sorted.length,
    continuousBars,
    ratio: continuousBars > 0 ? Math.min(1, sorted.length / continuousBars) : 0,
    firstTs,
    lastTs,
    missingHead,
    missingTail,
    gaps,
    complete: sorted.length > 0 && gaps.length === 0 && !missingHead && !missingTail,
  }
}

/**
 * Builds a coverage report from cheap range stats (count + first/last bar)
 * plus the fingerprint captured when the replay was created, WITHOUT loading
 * every bar.
 *
 * Interior gaps cannot be re-derived from stats, so this trusts the creation
 * check: `datasetBars` is the bar count the replay was verified complete with.
 * If the current count is >= that, the replay is at least as complete as it
 * was; a lower count means candles were removed (which the app has no path to
 * do) and is flagged.
 */
export function coverageFromStats(
  stats: { count: number; firstTs: string | null; lastTs: string | null },
  range: { start: string; end: string },
  timeframe: Timeframe,
  datasetBars: number | null,
): CoverageReport {
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000
  const startMs = new Date(range.start).getTime()
  const endMs = new Date(range.end).getTime()

  const continuousBars =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && barMs > 0
      ? Math.max(1, Math.round((endMs - startMs) / barMs))
      : 0

  const missingHead =
    stats.firstTs === null ||
    new Date(stats.firstTs).getTime() - startMs > 2 * barMs
  const missingTail =
    stats.lastTs === null ||
    endMs - new Date(stats.lastTs).getTime() > 2 * barMs

  // Fewer bars than the replay was created with -> the dataset changed.
  const shrank =
    datasetBars !== null && datasetBars > 0 && stats.count < datasetBars - 1

  return {
    timeframe,
    rangeStart: range.start,
    rangeEnd: range.end,
    actualBars: stats.count,
    continuousBars,
    ratio: continuousBars > 0 ? Math.min(1, stats.count / continuousBars) : 0,
    firstTs: stats.firstTs,
    lastTs: stats.lastTs,
    missingHead,
    missingTail,
    gaps: [],
    complete:
      stats.count > 0 && !missingHead && !missingTail && !shrank,
  }
}

/**
 * The contiguous covered span from the start of the report's range — i.e. how
 * far coverage can honestly be claimed. Used to record `candle_coverage` after
 * a fetch: a partial or interior-gapped response only claims up to its first
 * hole, so the rest is retried next time.
 */
export function coveredSpan(
  report: CoverageReport,
): { start: string; end: string } | null {
  if (report.actualBars === 0 || report.firstTs === null) return null

  // Where does the first hole begin?
  const firstGapAt =
    report.gaps.length > 0
      ? report.gaps[0].afterTs
      : report.missingTail && report.lastTs !== null
        ? report.lastTs
        : report.rangeEnd

  // The covered span runs from the range start (unless data starts late) to
  // the first hole.
  const start = report.missingHead ? report.firstTs : report.rangeStart
  const end = firstGapAt

  return new Date(end).getTime() > new Date(start).getTime()
    ? { start, end }
    : null
}
