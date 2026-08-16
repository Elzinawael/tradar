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
import type { Candle } from "./candles"
import {
  EMPTY_SUMMARY,
  buildDailyPnl,
  computePerformanceSummary,
} from "./analytics"
import type {
  BacktestSession,
  Profile,
  ReplaySession,
  SimulatedTrade,
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
    isDefault: Boolean(row.is_default),
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
    updatedAt: str(row.updated_at),
    notes: str(row.notes),
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

/** Scope shared by every analytics accessor. */
export interface AnalyticsScope {
  /** Restrict to one trading account. */
  accountId?: string
  /** Inclusive ISO lower bound on opened_at. */
  from?: string
  /** Inclusive ISO upper bound on opened_at. */
  to?: string
}

/**
 * All trades for the current user, newest first.
 *
 * Accepts either an account id (legacy call sites) or a full scope object.
 */
export async function getTrades(
  scope: string | AnalyticsScope = {},
): Promise<Trade[]> {
  const s: AnalyticsScope = typeof scope === "string" ? { accountId: scope } : scope

  const supabase = await createClient()
  if (!supabase) return []

  let query = supabase
    .from("trades")
    .select(
      "id, account_id, symbol, direction, entry_price, exit_price, quantity, pnl, r_multiple, strategy_id, opened_at, closed_at, duration_minutes, status, tags, strategies(name)",
    )
    .order("opened_at", { ascending: false })

  if (s.accountId) query = query.eq("account_id", s.accountId)
  if (s.from) query = query.gte("opened_at", s.from)
  if (s.to) query = query.lte("opened_at", s.to)

  const { data, error } = await query
  if (error || !data) return []
  return (data as Row[]).map(mapTrade)
}

/** Aggregate performance metrics computed from the user's closed trades. */
export async function getPerformanceSummary(
  scope: string | AnalyticsScope = {},
): Promise<PerformanceSummary> {
  const s: AnalyticsScope = typeof scope === "string" ? { accountId: scope } : scope

  const [trades, accounts] = await Promise.all([getTrades(s), getAccounts()])

  if (accounts.length === 0 && trades.length === 0) return EMPTY_SUMMARY

  return computePerformanceSummary(trades, startingBalanceFor(accounts, s.accountId))
}

/** Combined opening balance for the scoped account(s). */
export function startingBalanceFor(
  accounts: TradingAccount[],
  accountId?: string,
): number {
  const relevant = accountId
    ? accounts.filter((a) => a.id === accountId)
    : accounts
  return relevant.reduce((sum, a) => sum + a.startingBalance, 0)
}

/** Daily realised P&L, oldest first. */
export async function getDailyPnl(
  scope: string | AnalyticsScope = {},
): Promise<DailyPnl[]> {
  const trades = await getTrades(scope)
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
      "id, name, symbol, timeframe, strategy_id, initial_balance, risk_per_trade, created_at, updated_at, notes, status, net_pnl, trade_count",
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

/** A single journal entry for a specific date, or null when none exists. */
export async function getJournalEntryByDate(
  date: string,
): Promise<JournalEntry | null> {
  const supabase = await createClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("journal_entries")
    .select(
      "id, entry_date, pre_market_plan, session_notes, post_market_review, lessons, mood",
    )
    .eq("entry_date", date)
    .maybeSingle()

  if (error || !data) return null
  return mapJournalEntry(data as Row)
}

/** A single strategy by id, or null. */
export async function getStrategyById(id: string): Promise<Strategy | null> {
  const all = await getStrategies()
  return all.find((s) => s.id === id) ?? null
}


/** The signed-in user's profile, or null when unauthenticated. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, timezone")
    .maybeSingle()

  if (error || !data) return null
  const row = data as Row
  return {
    id: str(row.id),
    fullName: strOrNull(row.full_name),
    timezone: str(row.timezone, "UTC"),
  }
}

/** A single trading account by id, or null. */
export async function getAccountById(
  id: string,
): Promise<TradingAccount | null> {
  const accounts = await getAccounts()
  return accounts.find((a) => a.id === id) ?? null
}

/**
 * Everything needed to review a single trading day.
 *
 * Reuses getTrades() with a local-day scope and the shared analytics engine,
 * so a day's metrics are computed by exactly the same code as the dashboard's.
 */
export async function getDayDetail(dateKey: string): Promise<{
  trades: Trade[]
  summary: PerformanceSummary
  journal: JournalEntry | null
}> {
  // Local-day boundaries: a trading day is a day in the trader's timezone.
  const start = new Date(`${dateKey}T00:00:00`)
  const end = new Date(`${dateKey}T23:59:59.999`)

  const [trades, journal] = await Promise.all([
    getTrades({ from: start.toISOString(), to: end.toISOString() }),
    getJournalEntryByDate(dateKey),
  ])

  return {
    trades,
    summary: computePerformanceSummary(trades, 0),
    journal,
  }
}

// ---------------------------------------------------------------------------
// Backtesting
//
// Simulated trades map onto the same shape live trades use, so the existing
// analytics engine, trade-math helpers and TradeTable all work on them without
// a parallel implementation.
// ---------------------------------------------------------------------------

const BACKTEST_SESSION_COLUMNS =
  "id, name, symbol, timeframe, strategy_id, initial_balance, risk_per_trade, created_at, updated_at, notes, status, net_pnl, trade_count"

const BACKTEST_TRADE_COLUMNS =
  "id, session_id, symbol, direction, entry_price, exit_price, stop_price, take_profit, quantity, pnl, r_multiple, strategy_id, opened_at, closed_at, duration_minutes, status, tags, notes, strategies(name)"

function mapSimulatedTrade(row: Row): SimulatedTrade {
  const strategy = row.strategies as Row | null | undefined
  return {
    id: str(row.id),
    sessionId: str(row.session_id),
    symbol: str(row.symbol),
    direction: str(row.direction, "long") as TradeDirection,
    entryPrice: num(row.entry_price),
    exitPrice: numOrNull(row.exit_price),
    stopPrice: numOrNull(row.stop_price),
    takeProfit: numOrNull(row.take_profit),
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
    notes: str(row.notes),
  }
}

/** All backtest sessions for the current user, newest first. */
export async function getBacktestSessionList(): Promise<BacktestSession[]> {
  const supabase = await createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("backtest_sessions")
    .select(BACKTEST_SESSION_COLUMNS)
    .order("created_at", { ascending: false })

  if (error || !data) return []
  return (data as Row[]).map(mapBacktestSession)
}

/** A single session by id, or null when it is not the caller's. */
export async function getBacktestSessionById(
  id: string,
): Promise<BacktestSession | null> {
  const supabase = await createClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("backtest_sessions")
    .select(BACKTEST_SESSION_COLUMNS)
    .eq("id", id)
    .maybeSingle()

  if (error || !data) return null
  return mapBacktestSession(data as Row)
}

export interface SimulatedTradeQuery {
  symbol?: string
  direction?: string
  status?: string
  strategyId?: string
  from?: string
  to?: string
}

/** Simulated trades for a session, oldest first so the equity curve reads left to right. */
export async function getSimulatedTrades(
  sessionId: string,
  query: SimulatedTradeQuery = {},
): Promise<SimulatedTrade[]> {
  const supabase = await createClient()
  if (!supabase) return []

  let q = supabase
    .from("backtest_trades")
    .select(BACKTEST_TRADE_COLUMNS)
    .eq("session_id", sessionId)
    .order("opened_at", { ascending: true })

  if (query.symbol) q = q.ilike("symbol", `%${query.symbol}%`)
  if (query.direction) q = q.eq("direction", query.direction)
  if (query.status) q = q.eq("status", query.status)
  if (query.strategyId) q = q.eq("strategy_id", query.strategyId)
  if (query.from) q = q.gte("opened_at", query.from)
  if (query.to) q = q.lte("opened_at", query.to)

  const { data, error } = await q
  if (error || !data) return []
  return (data as Row[]).map(mapSimulatedTrade)
}

/** A single simulated trade by id, or null. */
export async function getSimulatedTradeById(
  id: string,
): Promise<SimulatedTrade | null> {
  const supabase = await createClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("backtest_trades")
    .select(BACKTEST_TRADE_COLUMNS)
    .eq("id", id)
    .maybeSingle()

  if (error || !data) return null
  return mapSimulatedTrade(data as Row)
}

export interface SessionPerformance {
  session: BacktestSession
  summary: PerformanceSummary
  daily: DailyPnl[]
}

/**
 * Performance for one session, computed by the shared analytics engine and
 * seeded with the session's own starting balance.
 */
export async function getSessionPerformance(
  session: BacktestSession,
  trades: SimulatedTrade[],
): Promise<SessionPerformance> {
  return {
    session,
    summary: computePerformanceSummary(trades, session.initialBalance),
    daily: buildDailyPnl(trades),
  }
}

export interface BacktestOverview {
  sessions: BacktestSession[]
  summary: PerformanceSummary
  totalSessions: number
  totalTrades: number
  best: { session: BacktestSession; netPnl: number } | null
  worst: { session: BacktestSession; netPnl: number } | null
  perSession: Map<string, PerformanceSummary>
}

/**
 * Aggregate across every session, for the backtesting dashboard.
 *
 * Trades are fetched once and grouped in memory rather than issuing a query
 * per session, so the dashboard stays at two round trips regardless of how
 * many sessions a user has.
 */
export async function getBacktestOverview(): Promise<BacktestOverview> {
  const empty: BacktestOverview = {
    sessions: [],
    summary: EMPTY_SUMMARY,
    totalSessions: 0,
    totalTrades: 0,
    best: null,
    worst: null,
    perSession: new Map(),
  }

  const supabase = await createClient()
  if (!supabase) return empty

  const sessions = await getBacktestSessionList()
  if (sessions.length === 0) return empty

  const { data, error } = await supabase
    .from("backtest_trades")
    .select(BACKTEST_TRADE_COLUMNS)
    .order("opened_at", { ascending: true })

  const all = error || !data ? [] : (data as Row[]).map(mapSimulatedTrade)

  const grouped = new Map<string, SimulatedTrade[]>()
  for (const trade of all) {
    const bucket = grouped.get(trade.sessionId) ?? []
    bucket.push(trade)
    grouped.set(trade.sessionId, bucket)
  }

  const perSession = new Map<string, PerformanceSummary>()
  let best: BacktestOverview["best"] = null
  let worst: BacktestOverview["worst"] = null

  for (const session of sessions) {
    const summary = computePerformanceSummary(
      grouped.get(session.id) ?? [],
      session.initialBalance,
    )
    perSession.set(session.id, summary)

    // Only sessions with closed trades can be ranked; an empty session has no
    // result, and calling it "worst" at 0 would be misleading.
    if (summary.tradeCount === 0) continue
    if (best === null || summary.netPnl > best.netPnl) {
      best = { session, netPnl: summary.netPnl }
    }
    if (worst === null || summary.netPnl < worst.netPnl) {
      worst = { session, netPnl: summary.netPnl }
    }
  }

  // Combined balance across sessions so the aggregate curve is meaningful.
  const totalStarting = sessions.reduce((sum, s) => sum + s.initialBalance, 0)

  return {
    sessions,
    summary: computePerformanceSummary(all, totalStarting),
    totalSessions: sessions.length,
    totalTrades: all.length,
    best,
    worst,
    perSession,
  }
}

// ---------------------------------------------------------------------------
// Candles and replay
// ---------------------------------------------------------------------------

function mapCandle(row: Row): Candle {
  return {
    ts: str(row.ts),
    open: num(row.open),
    high: num(row.high),
    low: num(row.low),
    close: num(row.close),
    volume: numOrNull(row.volume),
  }
}

/**
 * Candles for a symbol/timeframe within a range.
 *
 * `until` is the replay cursor. When supplied, no candle after it is returned,
 * so a future bar cannot reach the client through this path at all.
 */
export async function getCandles(params: {
  symbol: string
  timeframe: string
  from?: string
  to?: string
  until?: string
  limit?: number
}): Promise<Candle[]> {
  const supabase = await createClient()
  if (!supabase) return []

  let q = supabase
    .from("candles")
    .select("ts, open, high, low, close, volume")
    .eq("symbol", params.symbol)
    .eq("timeframe", params.timeframe)
    .order("ts", { ascending: true })

  if (params.from) q = q.gte("ts", params.from)
  if (params.to) q = q.lte("ts", params.to)
  if (params.until) q = q.lte("ts", params.until)
  q = q.limit(Math.min(20000, Math.max(1, params.limit ?? 5000)))

  const { data, error } = await q
  if (error || !data) return []
  return (data as Row[]).map(mapCandle)
}

/** Distinct symbol/timeframe pairs available to replay. */
export async function getCandleCatalog(): Promise<
  { symbol: string; timeframe: string; count: number; first: string; last: string }[]
> {
  const supabase = await createClient()
  if (!supabase) return []

  // No aggregate endpoint in PostgREST for this shape, so the summary view
  // does the grouping in Postgres.
  const { data, error } = await supabase
    .from("candle_catalog")
    .select("symbol, timeframe, candle_count, first_ts, last_ts")
    .order("symbol", { ascending: true })

  if (error || !data) return []
  return (data as Row[]).map((row) => ({
    symbol: str(row.symbol),
    timeframe: str(row.timeframe),
    count: num(row.candle_count),
    first: str(row.first_ts),
    last: str(row.last_ts),
  }))
}

function mapReplaySession(row: Row): ReplaySession {
  return {
    id: str(row.id),
    sessionId: str(row.session_id),
    symbol: str(row.symbol),
    timeframe: str(row.timeframe),
    rangeStart: str(row.range_start),
    rangeEnd: str(row.range_end),
    cursorTs: str(row.cursor_ts),
    speed: num(row.speed, 1),
  }
}

const REPLAY_COLUMNS =
  "id, session_id, symbol, timeframe, range_start, range_end, cursor_ts, speed, created_at"

/** Replay sessions belonging to the current user, newest first. */
export async function getReplaySessions(): Promise<ReplaySession[]> {
  const supabase = await createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("replay_sessions")
    .select(REPLAY_COLUMNS)
    .order("created_at", { ascending: false })

  if (error || !data) return []
  return (data as Row[]).map(mapReplaySession)
}

/** A single replay session by id, or null when it is not the caller's. */
export async function getReplaySessionById(
  id: string,
): Promise<ReplaySession | null> {
  const supabase = await createClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("replay_sessions")
    .select(REPLAY_COLUMNS)
    .eq("id", id)
    .maybeSingle()

  if (error || !data) return null
  return mapReplaySession(data as Row)
}

/**
 * Whether the current user is an administrator.
 *
 * Backed by public.is_admin(), which reads the admin_users table that no
 * client can write. This is used to decide what to SHOW; it is not the
 * security boundary — import_candles() enforces the same check inside the
 * database, so hiding the UI is a courtesy and the database is the control.
 */
export async function getIsAdmin(): Promise<boolean> {
  const supabase = await createClient()
  if (!supabase) return false

  const { data, error } = await supabase.rpc("is_admin")
  if (error) return false
  return data === true
}
