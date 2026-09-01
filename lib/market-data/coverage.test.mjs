import { test } from "node:test"
import assert from "node:assert/strict"
import {
  findMissingRanges,
  mergeSpans,
  missingRangesFromSpans,
  spansCover,
  subtractSpans,
} from "./coverage.ts"

const D = (iso) => new Date(iso)
const ms = (iso) => new Date(iso).getTime()

test("mergeSpans: sorts, drops empties, merges overlaps + touching", () => {
  assert.deepEqual(
    mergeSpans([
      { start: 30, end: 40 },
      { start: 0, end: 10 },
      { start: 5, end: 7 }, // inside the first
      { start: 10, end: 20 }, // touches [0,10]
      { start: 100, end: 100 }, // empty
    ]),
    [
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ],
  )
})

test("subtractSpans: interior hole is a real gap", () => {
  // Jan 1-5 and Jan 20-31 covered; request Jan 1-31 -> Jan 5-20 missing.
  const gaps = subtractSpans(
    { start: ms("2026-01-01"), end: ms("2026-01-31") },
    [
      { start: ms("2026-01-01"), end: ms("2026-01-05") },
      { start: ms("2026-01-20"), end: ms("2026-01-31") },
    ],
  )
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].start, ms("2026-01-05"))
  assert.equal(gaps[0].end, ms("2026-01-20"))
})

test("subtractSpans: missing head and tail", () => {
  const gaps = subtractSpans(
    { start: ms("2026-01-01"), end: ms("2026-01-31") },
    [{ start: ms("2026-01-10"), end: ms("2026-01-20") }],
  )
  assert.deepEqual(gaps, [
    { start: ms("2026-01-01"), end: ms("2026-01-10") },
    { start: ms("2026-01-20"), end: ms("2026-01-31") },
  ])
})

test("subtractSpans: fully covered -> no gaps; overlapping imports handled", () => {
  assert.deepEqual(
    subtractSpans({ start: 0, end: 100 }, [
      { start: 0, end: 60 },
      { start: 40, end: 100 }, // overlaps the first
    ]),
    [],
  )
})

test("subtractSpans: empty covered -> whole range", () => {
  assert.deepEqual(subtractSpans({ start: 10, end: 20 }, []), [
    { start: 10, end: 20 },
  ])
})

test("spansCover", () => {
  assert.equal(spansCover({ start: 0, end: 50 }, [{ start: 0, end: 100 }]), true)
  assert.equal(spansCover({ start: 0, end: 150 }, [{ start: 0, end: 100 }]), false)
})

test("missingRangesFromSpans: the audit's canonical example is NOT fully covered", () => {
  const rows = [
    { range_start: "2026-01-01T00:00:00Z", range_end: "2026-01-05T00:00:00Z" },
    { range_start: "2026-01-20T00:00:00Z", range_end: "2026-01-31T00:00:00Z" },
  ]
  const missing = missingRangesFromSpans(
    rows,
    D("2026-01-01T00:00:00Z"),
    D("2026-01-31T00:00:00Z"),
  )
  assert.equal(missing.length, 1)
  assert.equal(missing[0].from.toISOString(), "2026-01-05T00:00:00.000Z")
  assert.equal(missing[0].to.toISOString(), "2026-01-20T00:00:00.000Z")
})

test("missingRangesFromSpans: tolerance ignores a sub-minute sliver", () => {
  const rows = [
    { range_start: "2026-01-01T00:00:00Z", range_end: "2026-01-31T00:00:30Z" },
  ]
  // request ends 30s before the covered span's end -> covered
  const missing = missingRangesFromSpans(
    rows,
    D("2026-01-01T00:00:00Z"),
    D("2026-01-31T00:00:00Z"),
  )
  assert.equal(missing.length, 0)
})

test("findMissingRanges (legacy outer-bounds) still works for the fresh case", () => {
  assert.deepEqual(
    findMissingRanges({ first: null, last: null, candleCount: 0 }, D("2026-01-01"), D("2026-01-05")),
    [{ from: D("2026-01-01"), to: D("2026-01-05") }],
  )
})
