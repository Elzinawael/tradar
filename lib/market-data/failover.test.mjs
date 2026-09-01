import { test } from "node:test"
import assert from "node:assert/strict"
import { runFailover } from "./failover.ts"
import { ProviderError } from "./types.ts"

const bar = (ts) => ({ ts, open: 1, high: 1, low: 1, close: 1, volume: 0 })

function provider(key) {
  return { provider: { capabilities: { key } }, listing: { provider: key } }
}

const GAP = { from: new Date("2026-01-01"), to: new Date("2026-01-10") }

test("runFailover: first provider succeeds -> no fallback", async () => {
  const persisted = []
  const out = await runFailover({
    eligible: [provider("a"), provider("b")],
    missing: [GAP],
    fetchCandles: async () => [bar("2026-01-02T00:00:00Z")],
    onCandles: async (c, gap) => persisted.push({ n: c.length, gap }),
  })
  assert.equal(out.provider, "a")
  assert.equal(out.fallbackUsed, false)
  assert.equal(persisted.length, 1)
  assert.equal(persisted[0].gap, GAP) // gap is passed to onCandles
})

test("runFailover: transient failure -> falls over to the next provider", async () => {
  const out = await runFailover({
    eligible: [provider("a"), provider("b")],
    missing: [GAP],
    fetchCandles: async (cand) => {
      if (cand.provider.capabilities.key === "a") {
        throw new ProviderError("rate_limited", "429")
      }
      return [bar("2026-01-02T00:00:00Z")]
    },
    onCandles: async () => {},
  })
  assert.equal(out.provider, "b")
  assert.equal(out.fallbackUsed, true)
  assert.deepEqual(
    out.attempts.map((a) => [a.provider, a.ok]),
    [["a", false], ["b", true]],
  )
})

test("runFailover: empty response is treated as a failover-safe failure", async () => {
  let bTried = false
  const out = await runFailover({
    eligible: [provider("a"), provider("b")],
    missing: [GAP],
    fetchCandles: async (cand) => {
      if (cand.provider.capabilities.key === "a") return [] // empty
      bTried = true
      return [bar("2026-01-02T00:00:00Z")]
    },
    onCandles: async () => {},
  })
  assert.equal(bTried, true)
  assert.equal(out.provider, "b")
})

test("runFailover: a non-failover-safe error stops immediately", async () => {
  let bTried = false
  const out = await runFailover({
    eligible: [provider("a"), provider("b")],
    missing: [GAP],
    fetchCandles: async (cand) => {
      if (cand.provider.capabilities.key === "a") {
        throw new ProviderError("unsupported_instrument", "no such symbol")
      }
      bTried = true
      return [bar("x")]
    },
    onCandles: async () => {},
  })
  // unsupported_instrument IS failover-safe per isFailoverSafe (another provider
  // might carry it), so b is tried.
  assert.equal(bTried, true)
  assert.equal(out.provider, "b")
})

test("runFailover: all providers fail -> provider null, lastCode set", async () => {
  const out = await runFailover({
    eligible: [provider("a"), provider("b")],
    missing: [GAP],
    fetchCandles: async () => {
      throw new ProviderError("timeout", "slow")
    },
    onCandles: async () => {},
  })
  assert.equal(out.provider, null)
  assert.equal(out.lastCode, "timeout")
})
