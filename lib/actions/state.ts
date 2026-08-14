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
