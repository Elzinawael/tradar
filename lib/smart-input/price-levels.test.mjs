import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mirrorAcross,
  priceLevelGeometry,
  suggestStop,
  suggestTarget,
} from "./price-levels.ts"

test("priceLevelGeometry: long, 1:2 reward:risk", () => {
  const g = priceLevelGeometry({ entry: 5000, stop: 4975, target: 5050 })
  assert.equal(g.riskDistance, 25)
  assert.equal(g.rewardDistance, 50)
  assert.equal(g.riskReward, 2)
  assert.equal(g.stopPercent, -0.5)
  assert.equal(g.targetPercent, 1)
})

test("priceLevelGeometry: short (stop above, target below)", () => {
  const g = priceLevelGeometry({ entry: 5000, stop: 5025, target: 4950 })
  assert.equal(g.riskDistance, 25)
  assert.equal(g.rewardDistance, 50)
  assert.equal(g.riskReward, 2)
  assert.equal(g.stopPercent, 0.5)
  assert.equal(g.targetPercent, -1)
})

test("priceLevelGeometry: nulls when inputs missing or entry is zero", () => {
  assert.deepEqual(priceLevelGeometry({ entry: null, stop: 1, target: 2 }), {
    riskDistance: null,
    rewardDistance: null,
    riskReward: null,
    stopPercent: null,
    targetPercent: null,
  })
  const g = priceLevelGeometry({ entry: 5000, stop: null, target: 5050 })
  assert.equal(g.riskDistance, null)
  assert.equal(g.riskReward, null)
  assert.equal(g.rewardDistance, 50)
})

test("priceLevelGeometry: no riskReward when risk distance is zero", () => {
  const g = priceLevelGeometry({ entry: 5000, stop: 5000, target: 5050 })
  assert.equal(g.riskDistance, 0)
  assert.equal(g.riskReward, null)
})

test("suggestStop: below entry for long, above for short", () => {
  assert.equal(suggestStop(5000, "long", 2), 4987.5)
  assert.equal(suggestStop(5000, "short", 2), 5012.5)
  assert.equal(suggestStop(1.105, "long", 5, 0.25), 1.10224)
})

test("suggestTarget: above entry for long, below for short, ~1:2", () => {
  assert.equal(suggestTarget(5000, "long", 2), 5025)
  assert.equal(suggestTarget(5000, "short", 2), 4975)
  // default stop 0.25% / target 0.5% => 1:2
  const entry = 5000
  const stop = suggestStop(entry, "long", 2)
  const target = suggestTarget(entry, "long", 2)
  const g = priceLevelGeometry({ entry, stop, target })
  assert.equal(g.riskReward, 2)
})

test("mirrorAcross: preserves distance, flips side", () => {
  assert.equal(mirrorAcross(5000, 4975, 2), 5025)
  assert.equal(mirrorAcross(5000, 5050, 2), 4950)
  assert.equal(mirrorAcross(5000, 5000, 2), 5000)
})
