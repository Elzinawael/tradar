/**
 * TRADAR data access layer.
 *
 * Every accessor is scoped to the authenticated user. Row Level Security in
 * Postgres is the real authorization boundary — these queries never pass a
 * user id explicitly, they rely on `auth.uid()` in the RLS policies, so a bug
 * here cannot leak another user's rows.
 *
 * Graceful degradation: when Supabase is not configured (no env vars) or no
 * user is signed in, every accessor returns an empty collection or a zeroed
 * summary. That preserves the honest empty states the UI already renders and
 * keeps the project runnable and buildable without credentials.
 *
 * Return shapes are unchanged from the Stage 1 stubs, so UI components did not
 * need to be rewritten — only awaited.
 */

import { createClient } from "@/lib/supabase/server"
import {
  EMPTY_SUMMARY,
  buildDailyPnl,
  computePerformanceSummary,
} from "./analytics"
import type {
  BacktestSession,
  DailyPnl,
  JournalEntry,
  PerformanceSummary,
  ProgressRule,
  Strategy,
  Trade,
  TradeDirection,
  TradeStatus,
  TradingAccount,
} from "./types"

/** The all-zero summary, re-exported for callers that need a fallback. */
export const emptyPerformanceSummary: PerformanceSummary = EMPTY_SUMMARY

// ---------------------------------------------------------------------------
// Row mappers — snake_case (Postgres) -> camelCase (domain types)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : (value as number)
  return typeof n === "number" && Number.isFinite(n) ? n : fallback
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === "string" ? Number(value) : (value as number)
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function mapAccount(row: Row): TradingAccount {
  return {
    id: str(row.id),
    name: str(row.name),
    broker: strOrNull(row.broker),
    currency: str(row.currency, "USD"),
    startingBalance: num(row.starting_balance),
  }
}

function mapTrade(row: Row): Trade {
  const strategy = row.strategies as Row | null | undefined
  return {
    id: str(row.id),
    accountId: str(row.account_id),
    symbol: str(row.symbol),
    direction: str(row.direction, "long") as TradeDirection,
    entryPrice: num(row.entry_price),
    exitPrice: numOrNull(row.exit_price),
    quantity: num(row.quantity),
    pnl: num(row.pnl),
    rMultiple: numOrNull(row.r_multiple),
    strategyId: strOrNull(row.strategy_id),
    strategyName: strategy ? strOrNull(strategy.name) : null,
    openedAt: str(row.opened_at),
    closedAt: strOrNull(row.closed_at),
    durationMinutes: numOrNull(row.duration_minutes),
    status: str(row.status, "open") as TradeStatus,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
  }
}

function mapJournalEntry(row: Row): JournalEntry {
  return {
    id: str(row.id),
    date: str(row.entry_date),
    preMarketPlan: str(row.pre_market_plan),
    sessionNotes: str(row.session_notes),
    postMarketReview: str(row.post_market_review),
    lessons: str(row.lessons),
    mood: strOrNull(row.mood),
  }
}

function mapBacktestSession(row: Row): BacktestSession {
  return {
    id: str(row.id),
    name: str(row.name),
    symbol: str(row.symbol),
    timeframe: str(row.timeframe),
    strategyId: strOrNull(row.strategy_id),
    initialBalance: num(row.initial_balance),
    riskPerTrade: num(row.risk_per_trade),
    createdAt: str(row.created_at),
    status: str(row.status, "draft") as BacktestSession["status"],
    netPnl: numOrNull(row.net_pnl),
    tradeCount: num(row.trade_count),
  }
}

function mapProgressRule(row: Row): ProgressRule {
  return {
    id: str(row.id),
    label: str(row.label),
    completed: false,
  }
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** Trading accounts owned by the current user. */
export async function getAccounts(): Promise<TradingAccount[]> {
  const supabase = await createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("trading_accounts")
    .select("id, name, broker, currency, starting_balance, is_default")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })

  if (error || !data) return []
  return (data as Row[]).map(mapAccount)
}

/**
 * All trades for the current user, newest first.
 *
 * @param accountId restrict to a single trading account
 */
export async function getTrades(accountId?: string): Promise<Trade[]> {
  const supabase = await createClient()
  if (!supabase) return []

  let query = supabase
    .from("trades")
    .select(
      "id, account_id, symbol, direction, entry_price, exit_price, quantity, pnl, r_multiple, strategy_id, opened_at, closed_at, duration_minutes, status, tags, strategies(name)",
    )
    .order("opened_at", { ascending: false })

  if (accountId) query = query.eq("account_id", accountId)

  const { data, error } = await query
  if (error || !data) return []
  return (data as Row[]).map(mapTrade)
}

/** Aggregate performance metrics computed from the user's closed trades. */
export async function getPerformanceSummary(
  accountId?: string,
): Promise<PerformanceSummary> {
  const [trades, accounts] = await Promise.all([
    getTrades(accountId),
    getAccounts(),
  ])

  if (accounts.length === 0 && trades.length === 0) return EMPTY_SUMMARY

  const relevant = accountId
    ? accounts.filter((a) => a.id === accountId)
    : accounts
  const startingBalance = relevant.reduce(
    (sum, a) => sum + a.startingBalance,
    0,
  )

  return computePerformanceSummary(trades, startingBalance)
}

/** Daily realised P&L, oldest first. */
export async function getDailyPnl(accountId?: string): Promise<DailyPnl[]> {
  const trades = await getTrades(accountId)
  return buildDailyPnl(trades)
}

/** Strategy playbooks owned by the current user. */
export async function getStrategies(): Promise<Strategy[]> {
  const supabase = await createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("strategies")
    .select(
      "id, name, description, market, timeframe, entry_rules, exit_rules, risk_rules, checklist, notes",
    )
    .order("created_at", { ascending: false })

  if (error || !data) return []

  // Per-strategy statistics are derived from trades so they always agree with
  // the analytics engine rather than drifting in a denormalised column.
  const trades = await getTrades()

  return (data as Row[]).map((row) => {
    const id = str(row.id)
    const own = trades.filter((t) => t.strategyId === id)
    const summary = computePerformanceSummary(own, 0)

    return {
      id,
      name: str(row.name),
      description: str(row.description),
      market: str(row.market),
      timeframe: str(row.timeframe),
      entryRules: str(row.entry_rules),
      exitRules: str(row.exit_rules),
      riskRules: str(row.risk_rules),
      checklist: Array.isArray(row.checklist) ? (row.checklist as string[]) : [],
      notes: str(row.notes),
      tradeCount: summary.tradeCount,
      winRate: summary.winRate,
      netPnl: summary.netPnl,
      profitFactor: summary.profitFactor,
      expectancy: summary.expectancy,
    }
  })
}

/** Journal entries, newest first. */
export async function getJournalEntries(): Promise<JournalEntry[]> {
  const supabase = await createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("journal_entries")
    .select(
      "id, entry_date, pre_market_plan, session_notes, post_market_review, lessons, mood",
    )
    .order("entry_date", { ascending: false })

  if (error || !data) return []
  return (data as Row[]).map(mapJournalEntry)
}

/** Backtest sessions, newest first. */
export async function getBacktestSessions(): Promise<BacktestSession[]> {
  const supabase = await createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("backtest_sessions")
    .select(
      "id, name, symbol, timeframe, strategy_id, initial_balance, risk_per_trade, created_at, status, net_pnl, trade_count",
    )
    .order("created_at", { ascending: false })

  if (error || !data) return []
  return (data as Row[]).map(mapBacktestSession)
}

/**
 * Discipline rules with today's completion state.
 *
 * @param date completion date key (YYYY-MM-DD); defaults to today
 */
export async function getProgressRules(date?: string): Promise<ProgressRule[]> {
  const supabase = await createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("progress_rules")
    .select("id, label, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })

  if (error || !data) return []

  const rules = (data as Row[]).map(mapProgressRule)
  if (rules.length === 0) return rules

  const key = date ?? new Date().toISOString().slice(0, 10)
  const { data: completions } = await supabase
    .from("progress_completions")
    .select("rule_id, completed")
    .eq("completion_date", key)

  const done = new Map<string, boolean>()
  for (const row of (completions ?? []) as Row[]) {
    done.set(str(row.rule_id), Boolean(row.completed))
  }

  return rules.map((rule) => ({ ...rule, completed: done.get(rule.id) ?? false }))
}

// ---------------------------------------------------------------------------
// Trade queries with filtering, search, sorting and pagination
// ---------------------------------------------------------------------------

export interface TradeQuery {
  accountId?: string
  strategyId?: string
  symbol?: string
  status?: string
  direction?: string
  from?: string
  to?: string
  sort?: string
  direction_?: "asc" | "desc"
  page?: number
  pageSize?: number
}

export interface TradePage {
  trades: Trade[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

/** Columns a user is allowed to sort by (allow-list prevents injection). */
const SORTABLE = new Set([
  "opened_at",
  "closed_at",
  "symbol",
  "pnl",
  "quantity",
  "status",
  "r_multiple",
])

const TRADE_COLUMNS =
  "id, account_id, symbol, direction, entry_price, exit_price, quantity, pnl, r_multiple, strategy_id, opened_at, closed_at, duration_minutes, status, tags, strategies(name)"

/**
 * Paginated, filtered trade listing.
 *
 * Filtering and pagination run in Postgres rather than in the browser so the
 * page stays fast once a user has thousands of trades.
 */
export async function getTradesPage(query: TradeQuery = {}): Promise<TradePage> {
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const pageSize = Math.min(200, Math.max(5, Math.floor(query.pageSize ?? 25)))

  const supabase = await createClient()
  if (!supabase) {
    return { trades: [], total: 0, page, pageSize, pageCount: 0 }
  }

  const sortColumn =
    query.sort && SORTABLE.has(query.sort) ? query.sort : "opened_at"
  const ascending = query.direction_ === "asc"

  let q = supabase
    .from("trades")
    .select(TRADE_COLUMNS, { count: "exact" })
    .order(sortColumn, { ascending })

  if (query.accountId) q = q.eq("account_id", query.accountId)
  if (query.strategyId) q = q.eq("strategy_id", query.strategyId)
  if (query.status) q = q.eq("status", query.status)
  if (query.direction) q = q.eq("direction", query.direction)
  if (query.symbol) q = q.ilike("symbol", `%${query.symbol}%`)
  if (query.from) q = q.gte("opened_at", query.from)
  if (query.to) q = q.lte("opened_at", query.to)

  const fromIndex = (page - 1) * pageSize
  q = q.range(fromIndex, fromIndex + pageSize - 1)

  const { data, error, count } = await q
  if (error || !data) {
    return { trades: [], total: 0, page, pageSize, pageCount: 0 }
  }

  const total = count ?? 0
  return {
    trades: (data as Row[]).map(mapTrade),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  }
}

/** A single trade by id, or null when it does not exist or is not the user's. */
export async function getTradeById(id: string): Promise<Trade | null> {
  const supabase = await createClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("trades")
    .select(TRADE_COLUMNS)
    .eq("id", id)
    .maybeSingle()

  if (error || !data) return null
  return mapTrade(data as Row)
}

/** Distinct symbols the user has traded, for filter dropdowns. */
export async function getTradedSymbols(): Promise<string[]> {
  const supabase = await createClient()
  if (!supabase) return []

  const { data, error } = await supabase.from("trades").select("symbol")
  if (error || !data) return []

  const unique = new Set<string>()
  for (const row of data as Row[]) unique.add(str(row.symbol))
  return Array.from(unique).filter(Boolean).sort()
}
