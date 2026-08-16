/**
 * Shared server-action form state.
 *
 * Kept out of the "use server" modules because those files may only export
 * async functions — exporting a plain object or type from them breaks the
 * build with "A 'use server' file can only export async functions".
 */

export interface AuthActionState {
  error: string | null
  message: string | null
}

export const initialAuthState: AuthActionState = { error: null, message: null }

export interface TradeActionState {
  error: string | null
  fieldErrors: Record<string, string>
}

export const initialTradeState: TradeActionState = {
  error: null,
  fieldErrors: {},
}

export interface JournalActionState {
  error: string | null
  fieldErrors: Record<string, string>
}

export const initialJournalState: JournalActionState = {
  error: null,
  fieldErrors: {},
}

export interface StrategyActionState {
  error: string | null
  fieldErrors: Record<string, string>
}

export const initialStrategyState: StrategyActionState = {
  error: null,
  fieldErrors: {},
}

export interface SettingsActionState {
  error: string | null
  message: string | null
  fieldErrors: Record<string, string>
}

export const initialSettingsState: SettingsActionState = {
  error: null,
  message: null,
  fieldErrors: {},
}

export interface ImportActionState {
  error: string | null
  message: string | null
  imported: number
}

export const initialImportState: ImportActionState = {
  error: null,
  message: null,
  imported: 0,
}

export interface BacktestActionState {
  error: string | null
  fieldErrors: Record<string, string>
}

export const initialBacktestState: BacktestActionState = {
  error: null,
  fieldErrors: {},
}

export interface CandleImportState {
  error: string | null
  message: string | null
  imported: number
}

export const initialCandleImportState: CandleImportState = {
  error: null,
  message: null,
  imported: 0,
}
