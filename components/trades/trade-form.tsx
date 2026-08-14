"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import Link from "next/link"
import { AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { createTrade, updateTrade } from "@/lib/actions/trades"
import { initialTradeState, type TradeActionState } from "@/lib/actions/state"
import type { Strategy, Trade, TradingAccount } from "@/lib/types"
import { cn } from "@/lib/utils"

interface TradeFormProps {
  accounts: TradingAccount[]
  strategies: Strategy[]
  /** Present when editing an existing trade. */
  trade?: Trade
}

/** Converts an ISO timestamp to the value format datetime-local expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-negative">{message}</p>
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {isEdit ? "Save changes" : "Log trade"}
    </Button>
  )
}

export function TradeForm({ accounts, strategies, trade }: TradeFormProps) {
  const isEdit = Boolean(trade)
  const action = isEdit ? updateTrade : createTrade
  const [state, formAction] = useActionState<TradeActionState, FormData>(
    action,
    initialTradeState,
  )
  const errors = state.fieldErrors

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="flex flex-col gap-6">
          {isEdit && <input type="hidden" name="id" value={trade?.id} />}

          {state.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{state.error}</span>
            </div>
          )}

          {/* Instrument */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="symbol">Symbol</Label>
              <Input
                id="symbol"
                name="symbol"
                defaultValue={trade?.symbol}
                placeholder="EURUSD"
                required
                aria-invalid={Boolean(errors.symbol)}
              />
              <FieldError message={errors.symbol} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="direction">Side</Label>
              <Select name="direction" defaultValue={trade?.direction ?? "long"}>
                <SelectTrigger id="direction">
                  <SelectValue placeholder="Select side" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">Long</SelectItem>
                  <SelectItem value="short">Short</SelectItem>
                </SelectContent>
              </Select>
              <FieldError message={errors.direction} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="accountId">Account</Label>
              <Select
                name="accountId"
                defaultValue={trade?.accountId ?? accounts[0]?.id}
              >
                <SelectTrigger id="accountId">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.accountId} />
            </div>
          </div>

          {/* Prices */}
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="entryPrice">Entry price</Label>
              <Input
                id="entryPrice"
                name="entryPrice"
                type="number"
                step="any"
                min="0"
                defaultValue={trade?.entryPrice}
                required
                aria-invalid={Boolean(errors.entryPrice)}
              />
              <FieldError message={errors.entryPrice} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="exitPrice">Exit price</Label>
              <Input
                id="exitPrice"
                name="exitPrice"
                type="number"
                step="any"
                min="0"
                defaultValue={trade?.exitPrice ?? ""}
                placeholder="Leave blank if open"
                aria-invalid={Boolean(errors.exitPrice)}
              />
              <FieldError message={errors.exitPrice} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="stopPrice">Stop price</Label>
              <Input
                id="stopPrice"
                name="stopPrice"
                type="number"
                step="any"
                min="0"
                placeholder="Optional"
                aria-invalid={Boolean(errors.stopPrice)}
              />
              <p className="text-xs text-muted-foreground">Enables R-multiple.</p>
              <FieldError message={errors.stopPrice} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                step="any"
                min="0"
                defaultValue={trade?.quantity}
                required
                aria-invalid={Boolean(errors.quantity)}
              />
              <FieldError message={errors.quantity} />
            </div>
          </div>

          {/* Timing */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="openedAt">Entry time</Label>
              <Input
                id="openedAt"
                name="openedAt"
                type="datetime-local"
                defaultValue={toLocalInput(trade?.openedAt ?? null)}
                required
                aria-invalid={Boolean(errors.openedAt)}
              />
              <FieldError message={errors.openedAt} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="closedAt">Exit time</Label>
              <Input
                id="closedAt"
                name="closedAt"
                type="datetime-local"
                defaultValue={toLocalInput(trade?.closedAt ?? null)}
                aria-invalid={Boolean(errors.closedAt)}
              />
              <FieldError message={errors.closedAt} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="fees">Fees</Label>
              <Input
                id="fees"
                name="fees"
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                aria-invalid={Boolean(errors.fees)}
              />
              <FieldError message={errors.fees} />
            </div>
          </div>

          {/* Context */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="strategyId">Strategy</Label>
              <Select
                name="strategyId"
                defaultValue={trade?.strategyId ?? "none"}
              >
                <SelectTrigger id="strategyId">
                  <SelectValue placeholder="No strategy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No strategy</SelectItem>
                  {strategies.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                name="tags"
                defaultValue={trade?.tags.join(", ")}
                placeholder="breakout, london session"
              />
              <p className="text-xs text-muted-foreground">Comma separated.</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={4}
              placeholder="What was the setup? How did you execute?"
            />
          </div>

          <div className={cn("flex items-center gap-2")}>
            <SubmitButton isEdit={isEdit} />
            <Button asChild variant="ghost">
              <Link href={trade ? `/trades/${trade.id}` : "/trades"}>Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
