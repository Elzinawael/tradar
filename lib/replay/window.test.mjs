import { test } from "node:test"
import assert from "node:assert/strict"
import { mergeWindow, replayWindowStart } from "./window.ts"

const bar = (ts) => ({ ts, open: 1, high: 1, low: 1, close: 1 })

test("replayWindowStart: clamps to range start", () => {
  // cursor only 10 H1 bars into the range, lookback 5000 -> clamp to start
  assert.equal(
    replayWindowStart("2026-01-05T10:00:00Z", "2026-01-05T00:00:00Z", "H1"),
    "2026-01-05T00:00:00.000Z",
  )
})

test("replayWindowStart: bounded lookback for a deep cursor", () => {
  const start = replayWindowStart(
    "2026-06-01T00:00:00Z",
    "2026-01-01T00:00:00Z",
    "M1",
    100, // 100 minutes back
  )
  assert.equal(start, "2026-05-31T22:20:00.000Z")
})

test("mergeWindow: appends revealed, sorts, de-duplicates", () => {
  const base = [bar("2026-01-01T00:00:00Z"), bar("2026-01-01T01:00:00Z")]
  const revealed = [
    bar("2026-01-01T01:00:00Z"), // dup
    bar("2026-01-01T02:00:00Z"),
  ]
  const merged = mergeWindow(base, revealed)
  assert.deepEqual(
    merged.map((b) => b.ts),
    ["2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"],
  )
})

test("mergeWindow: caps at maxBars, dropping the oldest", () => {
  const base = Array.from({ length: 10 }, (_, i) =>
    bar(new Date(Date.UTC(2026, 0, 1, i)).toISOString()),
  )
  const revealed = [bar(new Date(Date.UTC(2026, 0, 1, 10)).toISOString())]
  const merged = mergeWindow(base, revealed, 5)
  assert.equal(merged.length, 5)
  assert.equal(merged[0].ts, new Date(Date.UTC(2026, 0, 1, 6)).toISOString())
  assert.equal(merged[4].ts, new Date(Date.UTC(2026, 0, 1, 10)).toISOString())
})

test("mergeWindow: no-op fast path when nothing revealed and under cap", () => {
  const base = [bar("2026-01-01T00:00:00Z")]
  const merged = mergeWindow(base, [])
  assert.deepEqual(merged, base)
  assert.notEqual(merged, base) // a copy
})
