/**
 * TRADAR domain types.
 *
 * These mirror the planned Supabase/PostgreSQL entities so that the data
 * access layer can be swapped from in-memory stubs to real queries in
 * Stage 2 without changing the UI.
 */

export type TradeDirection = "long" | "short"
export type TradeStatus = "win" | "loss" | "breakeven" | "open"

export interface TradingAccount {
  id: string
  name: string
  broker: string | null
  currency: string
  startingBalance: number
  /** The account selected by default in the account switcher. */
  isDefault: boolean
}

/** The signed-in user's profile record. */
export interface Profile {
  id: string
  fullName: string | null
  timezone: string
}

export interface Trade {
  id: string
  accountId: string
  symbol: string
  direction: TradeDirection
  entryPrice: number
  exitPrice: number | null
  quantity: number
  pnl: number
  rMultiple: number | null
  strategyId: string | null
  strategyName: string | null
  openedAt: string
  closedAt: string | null
  durationMinutes: number | null
  status: TradeStatus
  tags: string[]
}

export interface Execution {
  id: string
  tradeId: string
  side: "buy" | "sell"
  price: number
  quantity: number
  executedAt: string
}

export interface Strategy {
  id: string
  name: string
  description: string
  market: string
  timeframe: string
  entryRules: string
  exitRules: string
  riskRules: string
  checklist: string[]
  notes: string
  tradeCount: number
  winRate: number | null
  netPnl: number
  profitFactor: number | null
  expectancy: number | null
}

export interface JournalEntry {
  id: string
  date: string
  preMarketPlan: string
  sessionNotes: string
  postMarketReview: string
  lessons: string
  mood: string | null
}

export interface BacktestSession {
  id: string
  name: string
  symbol: string
  timeframe: string
  strategyId: string | null
  initialBalance: number
  riskPerTrade: number
  createdAt: string
  updatedAt: string
  notes: string
  status: "draft" | "running" | "completed"
  netPnl: number | null
  tradeCount: number
}

/**
 * A row shape the trade table can render.
 *
 * Simulated backtest trades carry every field a live trade does except
 * `accountId` — they belong to a session, not a funded account — so the table
 * accepts this narrower shape and `Trade` satisfies it structurally.
 */
export type TradeRow = Omit<Trade, "accountId">

/** A simulated trade belonging to a backtest session. */
export interface SimulatedTrade extends TradeRow {
  sessionId: string
  stopPrice: number | null
  takeProfit: number | null
  notes: string
  /** Whether the trade was hand-entered or produced by the replay engine. */
  origin: "manual" | "replay"
}

export interface ProgressRule {
  id: string
  label: string
  completed: boolean
}

/** Aggregated performance metrics for a set of trades. */
export interface PerformanceSummary {
  netPnl: number
  grossProfit: number
  grossLoss: number
  accountBalance: number
  winRate: number | null
  profitFactor: number | null
  averageWin: number
  averageLoss: number
  averageTradePnl: number
  expectancy: number | null
  largestProfit: number
  largestLoss: number
  maxDrawdown: number
  averageHoldMinutes: number | null
  tradingDays: number
  winningDays: number
  losingDays: number
  breakevenDays: number
  consecutiveWins: number
  consecutiveLosses: number
  tradeCount: number
}

export interface DailyPnl {
  date: string
  pnl: number
  trades: number
  result: "win" | "loss" | "breakeven"
}

/** A persisted replay: which market, which window, and how far it has run. */
export interface ReplaySession {
  id: string
  sessionId: string
  symbol: string
  timeframe: string
  rangeStart: string
  rangeEnd: string
  /** Furthest revealed bar. Never past rangeEnd. */
  cursorTs: string
  speed: number
}
