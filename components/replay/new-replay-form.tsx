"use client"

import { useActionState, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import Link from "next/link"
import { AlertCircle, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
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
import { cn } from "@/lib/utils"
import type { BacktestSession } from "@/lib/types"

export interface InstrumentOption {
  symbol: string
  displayName: string
  category: string
  /** True when a configured provider, or already-stored data, can serve it. */
  available: boolean
  storedBars: number
}

/** yyyy-MM-dd for a date `days` before today (local). */
function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const QUICK_RANGES = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "1y", days: 365 },
]

function PrepareButton({ prepared }: { prepared: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending
        ? "Checking market data…"
        : prepared
          ? "Re-check"
          : "Check availability"}
    </Button>
  )
}

function StartButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || blocked}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending ? "Preparing & starting…" : "Start replay"}
    </Button>
  )
}

/**
 * Replay setup — one linear flow:
 *
 *   pick market → pick period → check coverage (fetches missing data) →
 *   ready state → start.
 *
 * "Start replay" also verifies coverage server-side (createReplaySession),
 * so a replay is never created against data that cannot support it.
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
  const [from, setFrom] = useState(isoDaysAgo(90))
  const [to, setTo] = useState(isoDaysAgo(1))

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

  const ready = dataState.status === "ready"
  const partial = dataState.status === "unavailable" && dataState.candleCount > 0
  const rangeInvalid = !from || !to || to <= from

  function applyQuickRange(days: number) {
    setFrom(isoDaysAgo(days + 1))
    setTo(isoDaysAgo(1))
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 pt-6">
        {/* ── market + period ──────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Instrument" htmlFor="instrument">
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
          </Field>

          <Field label="Timeframe" htmlFor="timeframe">
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
          </Field>
        </div>

        {selected && (
          <p className="-mt-2 text-xs text-muted-foreground">
            {MARKET_CATEGORY_LABELS[
              selected.category as keyof typeof MARKET_CATEGORY_LABELS
            ] ?? selected.category}
            {selected.available
              ? " · a data source is configured"
              : selected.storedBars > 0
                ? " · imported data only (no live source)"
                : " · no data source — ask the operator to load it"}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Period</span>
            {QUICK_RANGES.map((r) => (
              <Button
                key={r.label}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => applyQuickRange(r.days)}
              >
                {r.label}
              </Button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" htmlFor="from">
              <Input
                id="from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                required
              />
            </Field>
            <Field label="To" htmlFor="to">
              <Input
                id="to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            </Field>
          </div>
          {rangeInvalid && (from || to) && (
            <p className="text-xs text-negative">
              Choose a start date and a later end date.
            </p>
          )}
        </div>

        {/* ── coverage check ───────────────────────────────────────────── */}
        <form
          action={prepareAction}
          className="flex flex-col gap-2 border-t border-border pt-4"
        >
          <input type="hidden" name="symbol" value={symbol} />
          <input type="hidden" name="timeframe" value={timeframe} />
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />

          <div className="flex flex-wrap items-center gap-3">
            <PrepareButton prepared={ready || partial} />

            {ready && (
              <span className="flex items-center gap-1.5 text-xs text-positive">
                <Check className="size-4" />
                {dataState.message}
              </span>
            )}
            {partial && (
              <span className="flex items-center gap-1.5 text-xs text-warning">
                <AlertCircle className="size-4" />
                {dataState.message}
              </span>
            )}
            {(dataState.status === "unavailable" && !partial) ||
            dataState.status === "error" ? (
              <span
                role="alert"
                className="flex items-start gap-1.5 text-xs text-muted-foreground"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-negative" />
                {dataState.message}
              </span>
            ) : null}
            {dataState.status === "idle" && (
              <span className="text-xs text-muted-foreground">
                Check whether the data for this window is available. Missing
                periods are fetched automatically.
              </span>
            )}
          </div>

          {dataState.providerDetail && (
            <p className="text-2xs text-muted-foreground">
              {dataState.providerDetail}
            </p>
          )}
        </form>

        {/* ── record into a session + start ───────────────────────────── */}
        <form
          action={formAction}
          className="flex flex-col gap-4 border-t border-border pt-4"
        >
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

          <Field
            label="Record trades into session"
            htmlFor="sessionId"
            error={state.fieldErrors.sessionId}
            className="sm:max-w-sm"
          >
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
          </Field>

          <p
            className={cn(
              "text-xs",
              ready ? "text-muted-foreground" : "text-muted-foreground",
            )}
          >
            {ready
              ? "Data is ready. Starting the replay verifies it once more."
              : "Starting the replay will fetch any missing data first — this can take a moment for a wide M1 range."}
          </p>

          <div className="flex items-center gap-2">
            <StartButton blocked={rangeInvalid || !symbol || sessions.length === 0} />
            <Button asChild variant="ghost">
              <Link href="/replay">Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
