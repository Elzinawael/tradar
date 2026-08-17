/**
 * Trade classification vocabulary.
 *
 * Setup grades, market sessions and suggested tags live here as plain data, not
 * as database enums. Two reasons: classification is optional, and the value set
 * should be able to change without a migration.
 *
 * `MARKET_SESSIONS` describes the trading period a trade occurred in. It is
 * deliberately never called "session" on its own — `backtest_sessions` already
 * means the simulation container.
 */

/** Setup quality grades, best first. */
export const SETUP_GRADES = ["A+", "A", "B+", "B", "C"] as const

export const MARKET_SESSIONS = [
  "Asia",
  "London",
  "New York",
  "London / New York overlap",
  "Other",
] as const

/**
 * Suggested tags offered in the UI. Not a closed set — a user may type
 * anything, and these exist only so the common cases are one click away.
 */
export const SUGGESTED_TAGS = [
  "FVG",
  "BOS",
  "Liquidity sweep",
  "SMT",
  "Ichimoku",
  "VWAP",
  "OB",
  "News",
  "Reversal",
  "Continuation",
] as const

/** Bounds enforced server-side; the database also caps field length. */
export const MAX_SETUP_LENGTH = 40
export const MAX_MARKET_SESSION_LENGTH = 40
export const MAX_TAG_LENGTH = 40
export const MAX_TAGS = 12
export const MAX_NOTES_LENGTH = 5000

/**
 * Normalises a free-text setup value.
 *
 * Custom values are allowed, so this validates shape rather than membership —
 * only length is enforced. Returns undefined when the value is unusable, which
 * the caller turns into a field error.
 */
export function normaliseSetup(raw: string): string | null | undefined {
  const value = raw.trim()
  if (value === "" || value === "none") return null
  if (value.length > MAX_SETUP_LENGTH) return undefined
  return value
}

/** Normalises a market session. Length-bounded, value set open. */
export function normaliseMarketSession(raw: string): string | null | undefined {
  const value = raw.trim()
  if (value === "" || value === "none") return null
  if (value.length > MAX_MARKET_SESSION_LENGTH) return undefined
  return value
}

/**
 * Parses a comma-separated tag list.
 *
 * Duplicates are collapsed case-insensitively while preserving the first
 * spelling the user typed, so "FVG, fvg" becomes one tag rather than two that
 * would split the analytics for the same concept.
 */
export function normaliseTags(raw: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []

  for (const part of raw.split(",")) {
    const tag = part.trim()
    if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }

  return tags
}
