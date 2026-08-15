"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createAccount, updateAccount } from "@/lib/actions/accounts"
import {
  initialSettingsState,
  type SettingsActionState,
} from "@/lib/actions/state"
import type { TradingAccount } from "@/lib/types"

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {label}
    </Button>
  )
}

/**
 * Shared create/edit form. Editing keeps the account inline in the list so the
 * user can see their other accounts while adjusting one.
 */
export function AccountForm({ account }: { account?: TradingAccount }) {
  const isEdit = Boolean(account)
  const [state, formAction] = useActionState<SettingsActionState, FormData>(
    isEdit ? updateAccount : createAccount,
    initialSettingsState,
  )
  const errors = state.fieldErrors

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit && <input type="hidden" name="id" value={account?.id} />}

      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{state.error}</span>
        </div>
      )}

      {state.message && (
        <div className="flex items-start gap-2 rounded-md border border-positive/30 bg-positive/10 p-3 text-xs text-positive">
          <Check className="mt-0.5 size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`name-${account?.id ?? "new"}`}>Account name</Label>
          <Input
            id={`name-${account?.id ?? "new"}`}
            name="name"
            defaultValue={account?.name}
            placeholder="Primary Account"
            required
          />
          {errors.name && <p className="text-xs text-negative">{errors.name}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`broker-${account?.id ?? "new"}`}>Broker</Label>
          <Input
            id={`broker-${account?.id ?? "new"}`}
            name="broker"
            defaultValue={account?.broker ?? ""}
            placeholder="Optional"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`currency-${account?.id ?? "new"}`}>Currency</Label>
          <Input
            id={`currency-${account?.id ?? "new"}`}
            name="currency"
            defaultValue={account?.currency ?? "USD"}
            placeholder="USD"
            maxLength={4}
            required
          />
          {errors.currency && (
            <p className="text-xs text-negative">{errors.currency}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`balance-${account?.id ?? "new"}`}>
            Starting balance
          </Label>
          <Input
            id={`balance-${account?.id ?? "new"}`}
            name="startingBalance"
            type="number"
            step="any"
            min="0"
            defaultValue={account?.startingBalance ?? 0}
          />
          {errors.startingBalance && (
            <p className="text-xs text-negative">{errors.startingBalance}</p>
          )}
        </div>
      </div>

      <div>
        <SubmitButton label={isEdit ? "Save changes" : "Add account"} />
      </div>
    </form>
  )
}
