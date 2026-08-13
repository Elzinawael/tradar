/**
 * TRADAR data access layer (Stage 1).
 *
 * Stage 1 intentionally ships with NO fabricated trading data. Every accessor
 * returns an empty collection or a zeroed summary so the UI renders honest
 * empty states. In Stage 2 these functions will be re-implemented as Supabase
 * queries scoped to the authenticated user — the return shapes will not change,
 * so the UI does not need to be rewritten.
 */

import type {
  BacktestSession,
  DailyPnl,
  JournalEntry,
  PerformanceSummary,
  ProgressRule,
  Strategy,
  Trade,
  TradingAccount,
} from "./types"

/** A single demo account shell so account selectors have something to show. */
export const accounts: TradingAccount[] = [
  {
    id: "primary",
    name: "Primary Account",
    broker: null,
    currency: "USD",
    startingBalance: 0,
  },
]

/** The empty (all-zero) performance summary used across the app in Stage 1. */
export const emptyPerformanceSummary: PerformanceSummary = {
  netPnl: 0,
  grossProfit: 0,
  grossLoss: 0,
  accountBalance: 0,
  winRate: null,
  profitFactor: null,
  averageWin: 0,
  averageLoss: 0,
  averageTradePnl: 0,
  expectancy: null,
  largestProfit: 0,
  largestLoss: 0,
  maxDrawdown: 0,
  averageHoldMinutes: null,
  tradingDays: 0,
  winningDays: 0,
  losingDays: 0,
  breakevenDays: 0,
  consecutiveWins: 0,
  consecutiveLosses: 0,
  tradeCount: 0,
}

export function getTrades(): Trade[] {
  return []
}

export function getPerformanceSummary(): PerformanceSummary {
  return emptyPerformanceSummary
}

export function getDailyPnl(): DailyPnl[] {
  return []
}

export function getStrategies(): Strategy[] {
  return []
}

export function getJournalEntries(): JournalEntry[] {
  return []
}

export function getBacktestSessions(): BacktestSession[] {
  return []
}

/** Default discipline rules a trader can track. */
export const defaultProgressRules: ProgressRule[] = [
  { id: "risk", label: "Follow risk management", completed: false },
  { id: "revenge", label: "No revenge trading", completed: false },
  { id: "strategy", label: "Follow strategy", completed: false },
  { id: "loss-limit", label: "Respect daily loss limit", completed: false },
  { id: "review", label: "Complete post-market review", completed: false },
]
