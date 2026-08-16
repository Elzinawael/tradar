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
import { saveBacktestSession } from "@/lib/actions/backtesting"
import {
  initialBacktestState,
  type BacktestActionState,
} from "@/lib/actions/state"
import type { BacktestSession, Strategy } from "@/lib/types"

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {isEdit ? "Save changes" : "Create session"}
    </Button>
  )
}

export function SessionForm({
  session,
  strategies,
}: {
  session?: BacktestSession
  strategies: Strategy[]
}) {
  const isEdit = Boolean(session)
  const [state, formAction] = useActionState<BacktestActionState, FormData>(
    saveBacktestSession,
    initialBacktestState,
  )
  const errors = state.fieldErrors

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="flex flex-col gap-6">
          {isEdit && <input type="hidden" name="id" value={session?.id} />}

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
              <Label htmlFor="name">Session name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={session?.name}
                placeholder="London breakout — Q1"
                required
              />
              {errors.name && (
                <p className="text-xs text-negative">{errors.name}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="symbol">Symbol</Label>
              <Input
                id="symbol"
                name="symbol"
                defaultValue={session?.symbol}
                placeholder="EURUSD"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="timeframe">Timeframe</Label>
              <Input
                id="timeframe"
                name="timeframe"
                defaultValue={session?.timeframe}
                placeholder="M15"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="initialBalance">Starting balance</Label>
              <Input
                id="initialBalance"
                name="initialBalance"
                type="number"
                step="any"
                min="0"
                defaultValue={session?.initialBalance ?? 10000}
              />
              {errors.initialBalance && (
                <p className="text-xs text-negative">{errors.initialBalance}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="riskPerTrade">Risk per trade (%)</Label>
              <Input
                id="riskPerTrade"
                name="riskPerTrade"
                type="number"
                step="any"
                min="0"
                max="100"
                defaultValue={session?.riskPerTrade ?? 1}
              />
              {errors.riskPerTrade && (
                <p className="text-xs text-negative">{errors.riskPerTrade}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="status">Status</Label>
              <Select name="status" defaultValue={session?.status ?? "draft"}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:max-w-sm">
            <Label htmlFor="strategyId">Strategy</Label>
            <Select
              name="strategyId"
              defaultValue={session?.strategyId ?? "none"}
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
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={4}
              defaultValue={session?.notes}
              placeholder="What are you testing, and over which period?"
            />
          </div>

          <div className="flex items-center gap-2">
            <SubmitButton isEdit={isEdit} />
            <Button asChild variant="ghost">
              <Link
                href={
                  session
                    ? `/backtesting/sessions/${session.id}`
                    : "/backtesting/sessions"
                }
              >
                Cancel
              </Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
