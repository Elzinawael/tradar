import { test } from "node:test"
import assert from "node:assert/strict"
import {
  assessCoverage,
  coverageFromStats,
  coveredSpan,
  findInteriorGaps,
} from "./dataset.ts"

/** Build H1 candles at `startIso`, one per hour, skipping indices in `skip`. */
function hourly(startIso, count, skip = new Set()) {
  const start = new Date(startIso).getTime()
  const out = []
  for (let i = 0; i < count; i += 1) {
    if (skip.has(i)) continue
    const ts = new Date(start + i * 3_600_000).toISOString()
    out.push({ ts, open: 100, high: 101, low: 99, close: 100, volume: 1 })
  }
  return out
}

test("findInteriorGaps: none for a continuous series", () => {
  assert.deepEqual(findInteriorGaps(hourly("2026-01-05T00:00:00Z", 48), "H1"), [])
})

test("findInteriorGaps: flags a mid-week hole larger than tolerance", () => {
  // drop bars 10..20 (11 bars) — an 11h hole on a Monday
  const skip = new Set([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  const gaps = findInteriorGaps(hourly("2026-01-05T00:00:00Z", 48, skip), "H1")
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].missingBars, 11)
})

test("findInteriorGaps: ignores a weekend-sized closure", () => {
  // Friday 20:00Z .. Sunday 22:00Z is ~50h — below the 74h closure threshold
  // would flag; a full ~62h+ weekend should not. Use a 3-day gap.
  const a = { ts: "2026-01-09T20:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: null }
  const b = { ts: "2026-01-12T22:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: null }
  assert.deepEqual(findInteriorGaps([a, b], "H1"), [])
})

test("findInteriorGaps: ignores gaps within tolerance", () => {
  const skip = new Set([10, 11]) // 2 missing bars, tolerance is 3
  assert.deepEqual(
    findInteriorGaps(hourly("2026-01-05T00:00:00Z", 24, skip), "H1"),
    [],
  )
})

test("assessCoverage: complete continuous dataset", () => {
  const candles = hourly("2026-01-05T00:00:00Z", 25)
  const report = assessCoverage(
    candles,
    { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" },
    "H1",
  )
  assert.equal(report.actualBars, 25)
  assert.equal(report.continuousBars, 24)
  assert.equal(report.complete, true)
  assert.equal(report.missingHead, false)
  assert.equal(report.missingTail, false)
})

test("assessCoverage: interior gap makes it incomplete", () => {
  const skip = new Set([8, 9, 10, 11, 12])
  const candles = hourly("2026-01-05T00:00:00Z", 25, skip)
  const report = assessCoverage(
    candles,
    { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" },
    "H1",
  )
  assert.equal(report.complete, false)
  assert.equal(report.gaps.length, 1)
  assert.equal(report.gaps[0].missingBars, 5)
})

test("assessCoverage: missing tail (provider returned a partial range)", () => {
  const candles = hourly("2026-01-05T00:00:00Z", 10) // only 10h of a 24h request
  const report = assessCoverage(
    candles,
    { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" },
    "H1",
  )
  assert.equal(report.missingTail, true)
  assert.equal(report.complete, false)
})

test("assessCoverage: empty dataset", () => {
  const report = assessCoverage(
    [],
    { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" },
    "H1",
  )
  assert.equal(report.actualBars, 0)
  assert.equal(report.complete, false)
  assert.equal(report.missingHead, true)
  assert.equal(report.missingTail, true)
  assert.equal(report.ratio, 0)
})

test("assessCoverage: deterministic — same input, same report", () => {
  const candles = hourly("2026-01-05T00:00:00Z", 20, new Set([5, 6, 7, 8]))
  const range = { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" }
  const a = assessCoverage(candles, range, "H1")
  const b = assessCoverage([...candles].reverse(), range, "H1")
  assert.deepEqual(a, b)
})

test("coveredSpan: complete range -> whole range covered", () => {
  const c = hourly("2026-01-05T00:00:00Z", 25)
  const r = assessCoverage(
    c,
    { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" },
    "H1",
  )
  const span = coveredSpan(r)
  assert.equal(span.start, "2026-01-05T00:00:00Z")
  assert.equal(span.end, "2026-01-06T00:00:00Z")
})

test("coveredSpan: partial (missing tail) -> claims only up to the last bar", () => {
  const c = hourly("2026-01-05T00:00:00Z", 10) // 10 of 24h
  const r = assessCoverage(
    c,
    { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" },
    "H1",
  )
  const span = coveredSpan(r)
  assert.equal(new Date(span.end).getTime(), new Date(r.lastTs).getTime())
})

test("coveredSpan: interior gap -> claims only up to the first hole", () => {
  const c = hourly("2026-01-05T00:00:00Z", 25, new Set([8, 9, 10, 11, 12]))
  const r = assessCoverage(
    c,
    { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" },
    "H1",
  )
  const span = coveredSpan(r)
  assert.equal(span.end, r.gaps[0].afterTs)
})

test("coveredSpan: empty -> null", () => {
  const r = assessCoverage(
    [],
    { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" },
    "H1",
  )
  assert.equal(coveredSpan(r), null)
})

test("coverageFromStats: complete when count matches fingerprint and edges present", () => {
  const r = coverageFromStats(
    {
      count: 25,
      firstTs: "2026-01-05T00:00:00Z",
      lastTs: "2026-01-06T00:00:00Z",
    },
    { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" },
    "H1",
    25,
  )
  assert.equal(r.complete, true)
  assert.equal(r.actualBars, 25)
})

test("coverageFromStats: flags a shrunken dataset", () => {
  const r = coverageFromStats(
    {
      count: 10,
      firstTs: "2026-01-05T00:00:00Z",
      lastTs: "2026-01-06T00:00:00Z",
    },
    { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" },
    "H1",
    25, // created with 25, now only 10
  )
  assert.equal(r.complete, false)
})

test("coverageFromStats: flags a missing head", () => {
  const r = coverageFromStats(
    {
      count: 20,
      firstTs: "2026-01-05T05:00:00Z", // starts 5h late
      lastTs: "2026-01-06T00:00:00Z",
    },
    { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" },
    "H1",
    null,
  )
  assert.equal(r.missingHead, true)
  assert.equal(r.complete, false)
})
