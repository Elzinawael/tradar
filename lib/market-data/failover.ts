/**
 * Failover orchestration.
 *
 * Extracted from the service so the loop can be tested against mocked
 * providers. The service owns I/O — Supabase reads and writes — while this
 * owns the decision sequence: who to try, when to give up on one provider, and
 * when to stop entirely.
 *
 * Keeping it pure matters because this is the part with the subtle rules. A
 * loop welded to a database client can only be exercised end-to-end, which in
 * practice means it is not exercised at all.
 */

import { isFailoverSafe, type ProviderAttempt, type ProviderErrorCode } from "./types"
import { ProviderError } from "./types"
import { recordFailure, recordSuccess } from "./health"
import type { EligibleProvider } from "./router"
import type { Candle } from "./types"

export interface FailoverRange {
  from: Date
  to: Date
}

export interface FailoverOutcome {
  /** Provider key that satisfied the request, or null when none did. */
  provider: string | null
  attempts: ProviderAttempt[]
  fallbackUsed: boolean
  candlesReceived: number
  /** Code from the last failure, for the customer-facing message. */
  lastCode: ProviderErrorCode | null
}

/**
 * Attempts each eligible provider in order until one covers every gap.
 *
 * Bounded by `eligible.length`: each provider is attempted at most once, so
 * the loop cannot spin regardless of what the adapters do.
 *
 * A provider is abandoned on its first error. Retrying the same provider for
 * the same gap is left to its own adapter — a stop here would double up with
 * any internal retry and turn one rate limit into several.
 *
 * `onCandles` is called per successful gap, so data already fetched is
 * persisted even if a LATER gap fails. Discarding it would mean re-downloading
 * on the next attempt, and partial progress is genuinely useful: the coverage
 * check the caller runs afterwards decides whether the request is satisfied.
 */
export async function runFailover(params: {
  eligible: EligibleProvider[]
  missing: FailoverRange[]
  fetchCandles: (
    candidate: EligibleProvider,
    range: FailoverRange,
  ) => Promise<Candle[]>
  onCandles: (candles: Candle[]) => Promise<void>
}): Promise<FailoverOutcome> {
  const { eligible, missing, fetchCandles, onCandles } = params

  const attempts: ProviderAttempt[] = []
  let lastCode: ProviderErrorCode | null = null
  let candlesReceived = 0

  for (const [index, candidate] of eligible.entries()) {
    const key = candidate.provider.capabilities.key
    let failed = false
    let received = 0

    for (const gap of missing) {
      try {
        const fetched = await fetchCandles(candidate, gap)

        // An empty answer is not automatically success. Where a provider
        // returns nothing for a gap another provider might cover, treating it
        // as complete is how missing history gets silently accepted.
        if (fetched.length === 0) {
          throw new ProviderError(
            "empty_data",
            "Provider returned no candles for the requested range",
          )
        }

        received += fetched.length
        await onCandles(fetched)
      } catch (error) {
        const code: ProviderErrorCode =
          error instanceof ProviderError ? error.code : "provider_unavailable"

        lastCode = code
        failed = true
        recordFailure(key, code)
        attempts.push({ provider: key, ok: false, code })

        // Whether the failure is failover-safe decides if the NEXT provider is
        // worth trying; either way this provider is done for this request.
        if (!isFailoverSafe(code)) {
          return {
            provider: null,
            attempts,
            fallbackUsed: index > 0,
            candlesReceived: candlesReceived + received,
            lastCode,
          }
        }
        break
      }
    }

    candlesReceived += received

    if (!failed) {
      recordSuccess(key)
      attempts.push({ provider: key, ok: true, code: null })
      return {
        provider: key,
        attempts,
        fallbackUsed: index > 0,
        candlesReceived,
        lastCode: null,
      }
    }
  }

  return {
    provider: null,
    attempts,
    fallbackUsed: eligible.length > 1,
    candlesReceived,
    lastCode,
  }
}
