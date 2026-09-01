import { test } from "node:test"
import assert from "node:assert/strict"
import { createReplayDataSource } from "./sources.ts"

function hourly(startIso, count, skip = new Set()) {
  const start = new Date(startIso).getTime()
  const out = []
  for (let i = 0; i < count; i += 1) {
    if (skip.has(i)) continue
    out.push({
      ts: new Date(start + i * 3_600_000).toISOString(),
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 1,
    })
  }
  return out
}

const RANGE = { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" }

function make(candles) {
  return createReplayDataSource({
    symbol: "BTCUSD",
    timeframe: "H1",
    pricePrecision: 2,
    range: RANGE,
    candles,
  })
}

test("snapshot is sorted, de-duplicated and range-clamped", () => {
  const dupes = [...hourly(RANGE.start, 5), ...hourly(RANGE.start, 3)]
  const outOfRange = {
    ts: "2026-02-01T00:00:00Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: null,
  }
  const src = make([...dupes.reverse(), outOfRange])
  const bars = src.allBars()
  assert.equal(bars.length, 5)
  for (let i = 1; i < bars.length; i += 1) {
    assert.ok(new Date(bars[i].ts).getTime() > new Date(bars[i - 1].ts).getTime())
  }
})

test("barsUpTo / barAt / priceAt respect the cursor (no look-ahead)", () => {
  const src = make(hourly(RANGE.start, 10))
  const cursor = new Date("2026-01-05T03:00:00Z").toISOString()
  assert.equal(src.barsUpTo(cursor).length, 4) // 00,01,02,03
  assert.equal(src.barAt(cursor)?.ts, cursor)
  assert.equal(src.priceAt(cursor), 103)
  assert.equal(src.priceAt("2026-01-04T00:00:00Z"), null) // before data
})

test("advance is deterministic and clamps to the range end", () => {
  const src = make(hourly(RANGE.start, 25))
  const a1 = src.advance(RANGE.start, 3)
  assert.equal(a1.revealed.length, 3)
  assert.equal(a1.atEnd, false)

  const a2 = src.advance(RANGE.start, 3)
  assert.deepEqual(a1, a2) // same input -> same output

  const toEnd = src.advance(RANGE.start, 999)
  assert.equal(toEnd.atEnd, true)
  assert.equal(new Date(toEnd.cursorTs).getTime() <= new Date(RANGE.end).getTime(), true)
})

test("coverage reports an interior gap", () => {
  const src = make(hourly(RANGE.start, 25, new Set([8, 9, 10, 11, 12])))
  const cov = src.coverage()
  assert.equal(cov.complete, false)
  assert.equal(cov.gaps.length, 1)
})

test("coverage is complete for a full continuous snapshot", () => {
  const src = make(hourly(RANGE.start, 25))
  assert.equal(src.coverage().complete, true)
})
