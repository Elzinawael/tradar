"use client"

import { useActionState, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import Link from "next/link"
import { AlertCircle, Check, Download, Loader2 } from "lucide-react"
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
import { ensureReplayData } from "@/lib/actions/market-data"
import {
  initialBacktestState,
  initialEnsureDataState,
  type BacktestActionState,
  type EnsureDataState,
} from "@/lib/actions/state"
import { TIMEFRAMES, TIMEFRAME_LABELS } from "@/lib/candles"
import { MARKET_CATEGORY_LABELS } from "@/lib/market-data/types"
import type { BacktestSession } from "@/lib/types"

export interface InstrumentOption {
  symbol: string
  displayName: string
  category: string
  /** True when a configured provider, or already-stored data, can serve it. */
  available: boolean
  storedBars: number
}

function PrepareButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Download className="size-4" />
      )}
      {pending ? "Fetching historical data…" : "Check / fetch data"}
    </Button>
  )
}

function StartButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      Start replay
    </Button>
  )
}

/**
 * Replay setup.
 *
 * The customer picks a market, a timeframe and a period. Tradar obtains
 * whatever candles are missing — no CSV, no provider choice, no mention of a
 * vendor. Data preparation is a separate step from starting the replay so a
 * download that takes a moment does not look like a failed submit.
 */
export function NewReplayForm({
  sessions,
  instruments,
}: {
  sessions: BacktestSession[]
  instruments: InstrumentOption[]
}) {
  const [symbol, setSymbol] = useState(instruments[0]?.symbol ?? "")
  const [timeframe, setTimeframe] = useState("H1")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const [dataState, prepareAction] = useActionState<EnsureDataState, FormData>(
    ensureReplayData,
    initialEnsureDataState,
  )
  const [state, formAction] = useActionState<BacktestActionState, FormData>(
    createReplaySession,
    initialBacktestState,
  )

  const selected = useMemo(
    () => instruments.find((i) => i.symbol === symbol),
    [instruments, symbol],
  )

  // The replay can only start once candles exist for the chosen window.
  const ready = dataState.status === "ready"

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          {/* Step 1 — choose the market and period, and prepare the data. */}
          <form action={prepareAction} className="flex flex-col gap-6">
            <input type="hidden" name="symbol" value={symbol} />
            <input type="hidden" name="timeframe" value={timeframe} />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="instrument">Instrument</Label>
                <Select value={symbol} onValueChange={setSymbol}>
                  <SelectTrigger id="instrument">
                    <SelectValue placeholder="Select an instrument" />
                  </SelectTrigger>
                  <SelectContent>
                    {instruments.map((i) => (
                      <SelectItem key={i.symbol} value={i.symbol}>
                        {i.symbol} — {i.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selected && (
                  <p className="text-xs text-muted-foreground">
                    {MARKET_CATEGORY_LABELS[
                      selected.category as keyof typeof MARKET_CATEGORY_LABELS
                    ] ?? selected.category}
                    {selected.available
                      ? " · data available"
                      : " · no data source configured"}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="timeframe">Timeframe</Label>
                <Select value={timeframe} onValueChange={setTimeframe}>
                  <SelectTrigger id="timeframe">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEFRAMES.map((tf) => (
                      <SelectItem key={tf} value={tf}>
                        {tf} — {TIMEFRAME_LABELS[tf]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="from">From</Label>
                <Input
                  id="from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="to">To</Label>
                <Input
                  id="to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <PrepareButton />

              {dataState.status === "ready" && (
                <span className="flex items-center gap-1.5 text-xs text-positive">
                  <Check className="size-4" />
                  {dataState.message}
                </span>
              )}

              {(dataState.status === "unavailable" ||
                dataState.status === "error") && (
                <span
                  role="alert"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <AlertCircle className="size-4 text-negative" />
                  {dataState.message}
                </span>
              )}
            </div>

            {/* Administrators see the routing decision; customers never do. */}
            {dataState.providerDetail && (
              <p className="text-[10px] text-muted-foreground">
                {dataState.providerDetail}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Step 2 — record into a session and start. */}
      <Card>
        <CardContent className="pt-6">
          <form action={formAction} className="flex flex-col gap-6">
            <input type="hidden" name="symbol" value={symbol} />
            <input type="hidden" name="timeframe" value={timeframe} />
            <input type="hidden" name="rangeStart" value={from} />
            <input type="hidden" name="rangeEnd" value={to} />

            {state.error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>{state.error}</span>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:max-w-sm">
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

            {!ready && (
              <p className="text-xs text-muted-foreground">
                Check the data for your chosen period first — the replay needs
                candles before it can start.
              </p>
            )}

            <div className="flex items-center gap-2">
              <StartButton disabled={!ready} />
              <Button asChild variant="ghost">
                <Link href="/replay">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
