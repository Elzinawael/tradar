import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeChartColor, readChartColors } from "./theme.ts"

/**
 * Regression guard for the production Replay crash: `readChartColors()` used to
 * hand raw `oklch(...)` design tokens straight to lightweight-charts 5.2.1,
 * whose parser throws `Failed to parse color: oklch(...)` during ReplayChart
 * mount. Every value it returns must now be a color that parser accepts.
 */

const OKLCH_TOKENS = [
  "oklch(0.66 0.012 260)",
  "oklch(0.72 0.16 155)",
  "oklch(0.79 0.13 82)",
  "oklch(0.7 0.11 240 / 0.5)",
]

// Stand-in for the browser's canvas color engine: resolves the oklch tokens
// this app actually ships to an sRGB rgb() string, rejects anything else.
const fakeBrowserNormalize = (input) =>
  input.startsWith("oklch(") ? "rgb(154, 161, 168)" : null

test("normalizeChartColor: converts oklch tokens via the browser color engine", () => {
  for (const token of OKLCH_TOKENS) {
    assert.equal(
      normalizeChartColor(token, "#000000", fakeBrowserNormalize),
      "rgb(154, 161, 168)",
    )
  }
})

test("normalizeChartColor: rejects a wide-gamut string from the normalizer (the lab() regression)", () => {
  // Current Chrome serializes the oklch tokens as lab() and canvas can read
  // them straight back in that syntax — which lightweight-charts still cannot
  // parse. Such a result must be discarded in favour of the safe fallback.
  for (const bad of ["lab(60.5199 -0.594348 -4.46695)", "oklch(0.66 0.012 260)", "color(srgb 0.6 0.63 0.66)"]) {
    assert.equal(
      normalizeChartColor("oklch(0.66 0.012 260)", "#9aa1a8", () => bad),
      "#9aa1a8",
    )
  }
})

test("normalizeChartColor: falls back when oklch cannot be normalized (no DOM)", () => {
  for (const token of OKLCH_TOKENS) {
    const out = normalizeChartColor(token, "#9aa1a8", () => null)
    assert.equal(out, "#9aa1a8")
    assert.doesNotMatch(out, /oklch/i)
  }
})

test("normalizeChartColor: passes already-safe colors through untouched", () => {
  for (const safe of ["#33b077", "#fff", "rgb(1, 2, 3)", "rgba(1,2,3,0.5)", "hsl(120 50% 50%)"]) {
    assert.equal(normalizeChartColor(safe, "#000000", () => null), safe)
  }
})

test("normalizeChartColor: empty / whitespace token yields the fallback", () => {
  assert.equal(normalizeChartColor("", "#e2b43c", () => null), "#e2b43c")
  assert.equal(normalizeChartColor("   ", "#e2b43c", () => null), "#e2b43c")
})

test("normalizeChartColor: prefers a normalized value over the raw safe form", () => {
  assert.equal(
    normalizeChartColor("#33b077", "#000000", () => "rgb(51, 176, 119)"),
    "rgb(51, 176, 119)",
  )
})

test("readChartColors: SSR fallback is entirely lightweight-charts-safe", () => {
  const colors = readChartColors()
  for (const value of Object.values(colors)) {
    assert.doesNotMatch(value, /oklch|oklab|lab\(|lch\(|color\(/i)
    assert.match(value, /^#[0-9a-f]{6}$/i)
  }
})
