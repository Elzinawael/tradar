"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import Link from "next/link"
import { AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { saveSimulatedTrade } from "@/lib/actions/backtesting"
import {
  initialBacktestState,
  type BacktestActionState,
} from "@/lib/actions/state"
import { MARKET_SESSIONS, SETUP_GRADES } from "@/lib/classification"
import type { SimulatedTrade, Strategy } from "@/lib/types"

/** ISO timestamp -> the value format datetime-local expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {isEdit ? "Save changes" : "Add simulated trade"}
    </Button>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-negative">{message}</p>
}

export function SimulatedTradeForm({
  sessionId,
  defaultSymbol,
  strategies,
  trade,
}: {
  sessionId: string
  defaultSymbol?: string
  strategies: Strategy[]
  trade?: SimulatedTrade
}) {
  const isEdit = Boolean(trade)
  const [state, formAction] = useActionState<BacktestActionState, FormData>(
    saveSimulatedTrade,
    initialBacktestState,
  )
  const errors = state.fieldErrors

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="sessionId" value={sessionId} />
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

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="symbol">Symbol</Label>
              <Input
                id="symbol"
                name="symbol"
                defaultValue={trade?.symbol ?? defaultSymbol}
                placeholder="EURUSD"
                required
              />
              <FieldError message={errors.symbol} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="direction">Side</Label>
              <Select name="direction" defaultValue={trade?.direction ?? "long"}>
                <SelectTrigger id="direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">Long</SelectItem>
                  <SelectItem value="short">Short</SelectItem>
                </SelectContent>
              </Select>
              <FieldError message={errors.direction} />
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
              />
              <FieldError message={errors.quantity} />
            </div>
          </div>

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
                placeholder="Blank if open"
              />
              <FieldError message={errors.exitPrice} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="stopPrice">Stop loss</Label>
              <Input
                id="stopPrice"
                name="stopPrice"
                type="number"
                step="any"
                min="0"
                defaultValue={trade?.stopPrice ?? ""}
                placeholder="Optional"
              />
              <p className="text-xs text-muted-foreground">Enables R-multiple.</p>
              <FieldError message={errors.stopPrice} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="takeProfit">Take profit</Label>
              <Input
                id="takeProfit"
                name="takeProfit"
                type="number"
                step="any"
                min="0"
                defaultValue={trade?.takeProfit ?? ""}
                placeholder="Optional"
              />
              <FieldError message={errors.takeProfit} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="openedAt">Entry time</Label>
              <Input
                id="openedAt"
                name="openedAt"
                type="datetime-local"
                defaultValue={toLocalInput(trade?.openedAt ?? null)}
                required
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
              />
              <FieldError message={errors.fees} />
            </div>
          </div>

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
              <Label htmlFor="setup">Setup</Label>
              <Select name="setup" defaultValue={trade?.setup ?? "none"}>
                <SelectTrigger id="setup">
                  <SelectValue placeholder="Not graded" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not graded</SelectItem>
                  {SETUP_GRADES.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="marketSession">Market session</Label>
              <Select
                name="marketSession"
                defaultValue={trade?.marketSession ?? "none"}
              >
                <SelectTrigger id="marketSession">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {MARKET_SESSIONS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
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
                placeholder="breakout, london"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={trade?.notes}
              placeholder="Why did this setup qualify?"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            P&amp;L, result, hold time and R-multiple are calculated by TRADAR
            from these inputs — the same way live trades are.
          </p>

          <div className="flex items-center gap-2">
            <SubmitButton isEdit={isEdit} />
            <Button asChild variant="ghost">
              <Link href={`/backtesting/sessions/${sessionId}`}>Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
