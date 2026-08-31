import { test } from "node:test"
import assert from "node:assert/strict"
import {
  clampToBounds,
  countDecimals,
  equalAtPrecision,
  inferPrecisionFromSamples,
  normalizePrecision,
  padToPrecision,
  parseNumeric,
  resolveSliderRange,
  resolveStep,
  roundToPrecision,
  sanitizeNumericInput,
  stepValue,
  toGroupedString,
  toPlainString,
} from "./number-field.ts"

test("normalizePrecision clamps and truncates", () => {
  assert.equal(normalizePrecision(2), 2)
  assert.equal(normalizePrecision(-1), 0)
  assert.equal(normalizePrecision(99), 12)
  assert.equal(normalizePrecision(3.7), 3)
  assert.equal(normalizePrecision(Number.NaN), 2)
})

test("countDecimals", () => {
  assert.equal(countDecimals(5025), 0)
  assert.equal(countDecimals(5025.5), 1)
  assert.equal(countDecimals(1.10502), 5)
  assert.equal(countDecimals(0.00001), 5)
  assert.equal(countDecimals(1e-5), 5)
})

test("roundToPrecision avoids float artefacts", () => {
  assert.equal(roundToPrecision(1.005, 2), 1.01)
  assert.equal(roundToPrecision(5000.0049, 2), 5000.0)
  assert.equal(roundToPrecision(1.105025, 5), 1.10503)
})

test("resolveStep: explicit wins, else derived from precision", () => {
  assert.equal(resolveStep(2), 0.01)
  assert.equal(resolveStep(5), 1e-5)
  assert.equal(resolveStep(0), 1)
  assert.equal(resolveStep(2, 0.25), 0.25)
  assert.equal(resolveStep(2, 0), 0.01)
  assert.equal(resolveStep(2, -1), 0.01)
})

test("sanitizeNumericInput keeps a form-submittable number", () => {
  assert.equal(sanitizeNumericInput("5025"), "5025")
  assert.equal(sanitizeNumericInput("5,025.50"), "5025.50")
  assert.equal(sanitizeNumericInput("$5 025.5"), "5025.5")
  assert.equal(sanitizeNumericInput("1.10.50"), "1.1050")
  assert.equal(sanitizeNumericInput("abc"), "")
  assert.equal(sanitizeNumericInput("-5"), "5") // negatives disallowed by default
  assert.equal(sanitizeNumericInput("-5", true), "-5")
  assert.equal(sanitizeNumericInput("5-3", true), "53")
  assert.equal(sanitizeNumericInput("."), ".")
})

test("parseNumeric handles empty and partial input", () => {
  assert.equal(parseNumeric(""), null)
  assert.equal(parseNumeric("   "), null)
  assert.equal(parseNumeric("."), null)
  assert.equal(parseNumeric("-"), null)
  assert.equal(parseNumeric("5025"), 5025)
  assert.equal(parseNumeric("5025."), 5025)
  assert.equal(parseNumeric("1.10502"), 1.10502)
})

test("toPlainString is ungrouped and fixed", () => {
  assert.equal(toPlainString(5025, 2), "5025.00")
  assert.equal(toPlainString(1.105, 5), "1.10500")
  assert.equal(toPlainString(60000.1, 2), "60000.10")
})

test("toGroupedString is grouped and fixed", () => {
  assert.equal(toGroupedString(5025, 2), "5,025.00")
  assert.equal(toGroupedString(60000.1, 2), "60,000.10")
})

test("padToPrecision pads but never truncates", () => {
  assert.equal(padToPrecision("5025", 2), "5025.00")
  assert.equal(padToPrecision("5025.5", 2), "5025.50")
  // more decimals than precision — kept exactly, no data loss
  assert.equal(padToPrecision("1.10502", 2), "1.10502")
  assert.equal(padToPrecision("", 2), "")
  assert.equal(padToPrecision(".", 2), ".")
})

test("clampToBounds", () => {
  assert.equal(clampToBounds(5, 0, 10), 5)
  assert.equal(clampToBounds(-3, 0, 10), 0)
  assert.equal(clampToBounds(99, 0, 10), 10)
  assert.equal(clampToBounds(99, undefined, undefined), 99)
  assert.equal(clampToBounds(-3, 0, null), 0)
})

test("stepValue: ArrowUp / ArrowDown from a value", () => {
  assert.equal(stepValue({ base: 5000, direction: 1, step: 0.01, precision: 2 }), 5000.01)
  assert.equal(stepValue({ base: 5000, direction: -1, step: 0.01, precision: 2 }), 4999.99)
  assert.equal(
    stepValue({ base: 5000, direction: 1, step: 0.01, precision: 2, multiplier: 10 }),
    5000.1,
  )
})

test("stepValue: from empty uses fallback / min / 0", () => {
  assert.equal(
    stepValue({ base: null, direction: 1, step: 0.01, precision: 2, fallback: 5000 }),
    5000.01,
  )
  assert.equal(
    stepValue({ base: null, direction: 1, step: 0.5, precision: 2, min: 1 }),
    1.5,
  )
  assert.equal(stepValue({ base: null, direction: 1, step: 1, precision: 0 }), 1)
})

test("stepValue: respects bounds", () => {
  assert.equal(
    stepValue({ base: 100, direction: 1, step: 10, precision: 2, max: 105 }),
    105,
  )
  assert.equal(
    stepValue({ base: 2, direction: -1, step: 10, precision: 2, min: 0 }),
    0,
  )
})

test("stepValue: never coarsens the user's existing decimals", () => {
  // precision says 2, but the value already has 5 decimals — keep them
  assert.equal(
    stepValue({ base: 1.10502, direction: 1, step: 0.01, precision: 2 }),
    1.11502,
  )
})

test("equalAtPrecision", () => {
  assert.equal(equalAtPrecision(5000, 5000.004, 2), true)
  assert.equal(equalAtPrecision(5000, 5000.02, 2), false)
  assert.equal(equalAtPrecision(null, 5000, 2), false)
})

test("inferPrecisionFromSamples", () => {
  assert.equal(inferPrecisionFromSamples([1.10501, 1.105, 1.1055]), 5)
  assert.equal(inferPrecisionFromSamples([2001.5, 2002.25]), 2)
  assert.equal(inferPrecisionFromSamples([], 3), 3)
  assert.equal(inferPrecisionFromSamples([Number.NaN], 4), 4)
})

test("resolveSliderRange: contextual window around a reference", () => {
  const r = resolveSliderRange({ reference: 5000, precision: 2, rangePercent: 0.5 })
  assert.deepEqual(r, { min: 4975, max: 5025 })
})

test("resolveSliderRange: explicit bounds win", () => {
  const r = resolveSliderRange({
    reference: 5000,
    precision: 2,
    explicitMin: 4000,
    explicitMax: 4999,
  })
  assert.deepEqual(r, { min: 4000, max: 4999 })
})

test("resolveSliderRange: null without a usable reference or bounds", () => {
  assert.equal(resolveSliderRange({ reference: null, precision: 2 }), null)
  assert.equal(resolveSliderRange({ reference: 0, precision: 2 }), null)
})

test("sequence: type -> ArrowUp -> blur", () => {
  // user types "5025"
  let raw = sanitizeNumericInput("5025")
  assert.equal(raw, "5025")
  // ArrowUp once (step 0.01)
  let n = parseNumeric(raw)
  const up = stepValue({ base: n, direction: 1, step: 0.01, precision: 2 })
  raw = toPlainString(up, Math.max(2, countDecimals(up)))
  assert.equal(raw, "5025.01")
  // blur pads (already at precision, unchanged)
  assert.equal(padToPrecision(raw, 2), "5025.01")
})

test("SAFETY: only an explicit reset moves a typed value to the reference", () => {
  const typed = "5025"
  // The reference the field is given changes underneath it.
  let reference = 5000
  // Re-deriving display state after the reference moves does NOT touch `typed`:
  const numeric = parseNumeric(typed)
  assert.equal(numeric, 5025)
  assert.equal(equalAtPrecision(numeric, reference, 2), false) // "away from reference"

  reference = 5010 // live price ticks
  assert.equal(parseNumeric(typed), 5025) // value is still exactly what was typed
  assert.equal(equalAtPrecision(parseNumeric(typed), reference, 2), false)

  // The ONLY primitive that returns the reference as a new field value:
  const afterReset = toPlainString(reference, 2)
  assert.equal(afterReset, "5010.00")
})

test("reference at the field value is recognised (reset becomes a no-op)", () => {
  assert.equal(equalAtPrecision(parseNumeric("5000.00"), 5000, 2), true)
  assert.equal(equalAtPrecision(parseNumeric("5000.004"), 5000, 2), true)
})
