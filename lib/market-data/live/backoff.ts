/**
 * Reconnect backoff.
 *
 * Pure and injectable so the schedule can be asserted without waiting in real
 * time.
 */

export const BASE_DELAY_MS = 1_000
export const MAX_DELAY_MS = 30_000

/**
 * Delay before reconnect attempt `attempt` (0-based).
 *
 * Doubles from 1s and caps at 30s, then adds up to 25% jitter. The cap stops a
 * long outage from pushing retries hours apart; the jitter stops every client
 * that dropped at the same moment from reconnecting in the same instant and
 * re-creating the surge that caused the drop.
 *
 * @param random injectable for deterministic tests.
 */
export function backoffDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt))
  const exponential = Math.min(
    MAX_DELAY_MS,
    BASE_DELAY_MS * 2 ** Math.min(safeAttempt, 16),
  )
  const jitter = exponential * 0.25 * random()
  return Math.round(exponential + jitter)
}
