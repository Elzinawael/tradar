/**
 * Date range resolution for analytics filters.
 *
 * Trading days are calendar days in the trader's own timezone, not UTC days.
 * A trade closed at 22:00 New York time on Friday belongs to Friday's P&L even
 * though it is already Saturday in UTC. These helpers therefore build
 * boundaries from LOCAL calendar components and only convert to ISO at the
 * edge, which keeps them consistent with `toDateKey()` in lib/analytics.ts.
 *
 * Ranges are inclusive on both ends: `from` is 00:00:00.000 of the first day
 * and `to` is 23:59:59.999 of the last day.
 */

export type RangeKey =
  | "today"
  | "week"
  | "month"
  | "quarter"
  | "ytd"
  | "all"

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  quarter: "This Quarter",
  ytd: "Year to Date",
  all: "All Time",
}

export const RANGE_KEYS = Object.keys(RANGE_LABELS) as RangeKey[]

export function isRangeKey(value: string | undefined): value is RangeKey {
  return value !== undefined && (RANGE_KEYS as string[]).includes(value)
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

export interface ResolvedRange {
  key: RangeKey
  label: string
  from?: string
  to?: string
}

/**
 * Converts a range key into concrete ISO bounds.
 *
 * @param key  the selected range
 * @param now  injectable clock, so this is deterministic under test
 */
export function resolveRange(key: RangeKey, now: Date = new Date()): ResolvedRange {
  const label = RANGE_LABELS[key]

  if (key === "all") return { key, label }

  const to = endOfDay(now).toISOString()

  if (key === "today") {
    return { key, label, from: startOfDay(now).toISOString(), to }
  }

  if (key === "week") {
    // Week starts Monday: trading weeks are conventionally Mon–Fri, and
    // getDay() returns 0 for Sunday, which would otherwise split the week.
    const day = now.getDay()
    const daysSinceMonday = day === 0 ? 6 : day - 1
    const monday = new Date(now)
    monday.setDate(now.getDate() - daysSinceMonday)
    return { key, label, from: startOfDay(monday).toISOString(), to }
  }

  if (key === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    return { key, label, from: startOfDay(first).toISOString(), to }
  }

  if (key === "quarter") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
    const first = new Date(now.getFullYear(), quarterStartMonth, 1)
    return { key, label, from: startOfDay(first).toISOString(), to }
  }

  // ytd
  const jan1 = new Date(now.getFullYear(), 0, 1)
  return { key, label, from: startOfDay(jan1).toISOString(), to }
}

/** Resolves an untrusted query-string value, falling back to "all". */
export function resolveRangeParam(
  value: string | undefined,
  now: Date = new Date(),
): ResolvedRange {
  return resolveRange(isRangeKey(value) ? value : "all", now)
}
