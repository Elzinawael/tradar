/**
 * Provider health and circuit breaking.
 *
 * ── WHY THIS IS IN MEMORY, AND WHAT THAT COSTS ────────────────────────────
 * State lives in a module-level map, so it is scoped to ONE server process and
 * is lost on restart. That is a deliberate choice for this phase, not an
 * oversight:
 *
 *   * A breaker exists to stop hammering a provider that is already failing.
 *     Getting that mostly right in-process removes almost all of the wasted
 *     calls; the remainder is not worth a table.
 *   * Persisting it in Postgres would mean a write on every provider failure
 *     and a read on every routing decision — turning a fast in-memory check
 *     into database traffic on the hot path.
 *   * It would also mean one customer's bad minute could disable a provider
 *     for everyone, globally and durably. A process-scoped breaker limits the
 *     blast radius, which is the safer default while the failure modes are
 *     still being learned.
 *
 * The trade-off is real and worth stating: across several instances, each
 * keeps its own view, so a failing provider may be retried once per process
 * rather than once globally. If that becomes expensive, the fix is a shared
 * store (Redis, or a small table) behind this same interface — nothing outside
 * this file needs to change.
 *
 * No credentials are stored here, and nothing here is exposed to the browser.
 */

import type { ProviderErrorCode } from "./types.ts"
import { isProviderFault } from "./types.ts"

/** Consecutive provider faults before the breaker opens. */
export const FAILURE_THRESHOLD = 3

/** How long the breaker stays open before allowing another attempt. */
export const COOLDOWN_MS = 60_000

interface ProviderHealth {
  consecutiveFailures: number
  lastFailureAt: number | null
  lastFailureCode: ProviderErrorCode | null
  /** Epoch ms until which the provider is skipped. */
  disabledUntil: number | null
}

const health = new Map<string, ProviderHealth>()

function entry(provider: string): ProviderHealth {
  const existing = health.get(provider)
  if (existing) return existing
  const fresh: ProviderHealth = {
    consecutiveFailures: 0,
    lastFailureAt: null,
    lastFailureCode: null,
    disabledUntil: null,
  }
  health.set(provider, fresh)
  return fresh
}

/**
 * Whether the breaker is currently open for a provider.
 *
 * @param now injectable clock so cooldown expiry is testable without waiting.
 */
export function isCircuitOpen(provider: string, now: number = Date.now()): boolean {
  const state = health.get(provider)
  if (!state || state.disabledUntil === null) return false

  if (now >= state.disabledUntil) {
    // Cooldown elapsed: allow one attempt through. The failure count is kept,
    // so a provider that is still broken re-opens immediately rather than
    // needing another full threshold of failures.
    state.disabledUntil = null
    return false
  }

  return true
}

/**
 * Records a failed attempt.
 *
 * Only genuine provider faults count. An unsupported symbol or a missing API
 * key says nothing about the provider's health and must not trip the breaker.
 */
export function recordFailure(
  provider: string,
  code: ProviderErrorCode,
  now: number = Date.now(),
): void {
  const state = entry(provider)
  state.lastFailureAt = now
  state.lastFailureCode = code

  if (!isProviderFault(code)) return

  state.consecutiveFailures += 1
  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.disabledUntil = now + COOLDOWN_MS
  }
}

/** Records a success, clearing the failure count and closing the breaker. */
export function recordSuccess(provider: string): void {
  const state = entry(provider)
  state.consecutiveFailures = 0
  state.disabledUntil = null
  state.lastFailureCode = null
}

/** Read-only snapshot for admin diagnostics. Contains no credentials. */
export function getHealthSnapshot(): Record<
  string,
  {
    consecutiveFailures: number
    lastFailureCode: ProviderErrorCode | null
    disabled: boolean
  }
> {
  const now = Date.now()
  const out: Record<
    string,
    {
      consecutiveFailures: number
      lastFailureCode: ProviderErrorCode | null
      disabled: boolean
    }
  > = {}

  for (const [provider, state] of health.entries()) {
    out[provider] = {
      consecutiveFailures: state.consecutiveFailures,
      lastFailureCode: state.lastFailureCode,
      disabled: state.disabledUntil !== null && now < state.disabledUntil,
    }
  }

  return out
}

/** Clears all health state. Test support only. */
export function resetHealth(): void {
  health.clear()
}
