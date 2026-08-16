"use client"

import { useActionState, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import Link from "next/link"
import { AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createReplaySession } from "@/lib/actions/replay"
import {
  initialBacktestState,
  type BacktestActionState,
} from "@/lib/actions/state"
import type { BacktestSession } from "@/lib/types"

interface CatalogEntry {
  symbol: string
  timeframe: string
  count: number
  first: string
  last: string
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      Start replay
    </Button>
  )
}

export function NewReplayForm({
  sessions,
  catalog,
}: {
  sessions: BacktestSession[]
  catalog: CatalogEntry[]
}) {
  const [state, formAction] = useActionState<BacktestActionState, FormData>(
    createReplaySession,
    initialBacktestState,
  )

  const [pair, setPair] = useState(
    catalog.length > 0 ? `${catalog[0].symbol}|${catalog[0].timeframe}` : "",
  )

  const selected = useMemo(
    () => catalog.find((c) => `${c.symbol}|${c.timeframe}` === pair),
    [catalog, pair],
  )

  const [symbol, timeframe] = pair.split("|")

  // Default the range to the data actually available, so a user cannot pick a
  // window with no candles in it.
  const defaultFrom = selected ? selected.first.slice(0, 10) : ""
  const defaultTo = selected ? selected.last.slice(0, 10) : ""

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="symbol" value={symbol ?? ""} />
          <input type="hidden" name="timeframe" value={timeframe ?? ""} />

          {state.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pair">Market</Label>
              <Select value={pair} onValueChange={setPair}>
                <SelectTrigger id="pair">
                  <SelectValue placeholder="Select market" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((c) => (
                    <SelectItem
                      key={`${c.symbol}|${c.timeframe}`}
                      value={`${c.symbol}|${c.timeframe}`}
                    >
                      {c.symbol} · {c.timeframe} ({c.count.toLocaleString()} bars)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {catalog.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No candles loaded.{" "}
                  <Link href="/replay/data" className="text-primary underline-offset-2 hover:underline">
                    Import market data
                  </Link>{" "}
                  first.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sessionId">Record into session</Label>
              <Select name="sessionId" defaultValue={sessions[0]?.id}>
                <SelectTrigger id="sessionId">
                  <SelectValue placeholder="Select session" />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {state.fieldErrors.sessionId && (
                <p className="text-xs text-negative">
                  {state.fieldErrors.sessionId}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="rangeStart">From</Label>
              <Input
                id="rangeStart"
                name="rangeStart"
                type="date"
                defaultValue={defaultFrom}
                key={`from-${defaultFrom}`}
                required
              />
              {state.fieldErrors.rangeStart && (
                <p className="text-xs text-negative">
                  {state.fieldErrors.rangeStart}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rangeEnd">To</Label>
              <Input
                id="rangeEnd"
                name="rangeEnd"
                type="date"
                defaultValue={defaultTo}
                key={`to-${defaultTo}`}
                required
              />
              {state.fieldErrors.rangeEnd && (
                <p className="text-xs text-negative">
                  {state.fieldErrors.rangeEnd}
                </p>
              )}
            </div>
          </div>

          {selected && (
            <p className="text-xs text-muted-foreground">
              {selected.symbol} {selected.timeframe} has data from{" "}
              {new Date(selected.first).toLocaleDateString()} to{" "}
              {new Date(selected.last).toLocaleDateString()}.
            </p>
          )}

          <div className="flex items-center gap-2">
            <SubmitButton />
            <Button asChild variant="ghost">
              <Link href="/replay">Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
