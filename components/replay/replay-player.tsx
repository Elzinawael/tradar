"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  ChevronRight,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { ReplayChart } from "./replay-chart"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { visibleCandles, type Candle } from "@/lib/candles"
import { computePositionSize } from "@/lib/trade-math"
import { computeUnrealized, validateLevels } from "@/lib/replay-engine"
import {
  advanceReplay,
  closeReplayPosition,
  openReplayPosition,
  resetReplay,
} from "@/lib/actions/replay"
import { initialBacktestState } from "@/lib/actions/state"
import { cn, formatCurrency } from "@/lib/utils"
import {
  MARKET_SESSIONS,
  SETUP_GRADES,
  SUGGESTED_TAGS,
} from "@/lib/classification"
import type { ReplaySession, SimulatedTrade, Strategy } from "@/lib/types"

const SPEEDS = [0.5, 1, 2, 5, 10, 25]

interface ReplayPlayerProps {
  replay: ReplaySession
  /**
   * Bars for the selected range, prefetched so the chart can redraw without a
   * round trip per frame. Only bars at or before the cursor are rendered, and
   * the cursor itself is authoritative on the server — this array is never
   * used to decide an exit.
   */
  candles: Candle[]
  balance: number
  riskPercent: number
  /** The currently open position, or null when flat. */
  openPosition: SimulatedTrade | null
  /** The user's strategies, for classifying the trade before opening it. */
  strategies: Strategy[]
}

export function ReplayPlayer({
  replay,
  candles,
  balance,
  riskPercent,
  openPosition,
  strategies,
}: ReplayPlayerProps) {
  const router = useRouter()
  const [cursorTs, setCursorTs] = useState(replay.cursorTs)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(replay.speed || 1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [atEnd, setAtEnd] = useState(false)

  const visible = useMemo(
    () => visibleCandles(candles, cursorTs),
    [candles, cursorTs],
  )
  const current = visible[visible.length - 1] ?? null

  // Guards against overlapping advance calls when a tick is slower than the
  // interval, which would otherwise skip bars or evaluate them out of order.
  const inFlight = useRef(false)

  /**
   * The single cursor-advance path, used by both Step and Play.
   *
   * The server advances the cursor, evaluates the open position against only
   * the newly revealed bars, and reports any resulting exit.
   */
  const advance = useCallback(
    async (bars: number) => {
      if (inFlight.current) return
      inFlight.current = true
      try {
        const result = await advanceReplay(replay.id, bars)
        if (result.error) {
          setError(result.error)
          setPlaying(false)
          return
        }
        if (result.cursorTs) setCursorTs(result.cursorTs)
        setAtEnd(result.atEnd)
        if (result.atEnd) setPlaying(false)

        if (result.closed) {
          // Playback stops on a fill so the outcome is not scrolled past. The
          // rule is deliberate and applies to both Step and Play.
          setPlaying(false)
          const { reason, exitPrice, pnl, gapped } = result.closed
          setNotice(
            `${reason === "stop" ? "Stop loss" : "Take profit"} hit at ${exitPrice}${
              gapped ? " (gap fill at the open)" : ""
            } — ${formatCurrency(pnl, { signed: true })}`,
          )
          router.refresh()
        }
      } finally {
        inFlight.current = false
      }
    },
    [replay.id, router],
  )

  const isPlaying = playing && !atEnd

  // Playback drives the same server action as Step. Bars per tick scale with
  // speed so the effective rate is honoured without one request per frame.
  useEffect(() => {
    if (!isPlaying) return
    const tickMs = Math.max(220, 1000 / speed)
    const barsPerTick = Math.max(1, Math.round((speed * tickMs) / 1000))
    const id = window.setInterval(() => void advance(barsPerTick), tickMs)
    return () => window.clearInterval(id)
  }, [isPlaying, speed, advance])

  // --- order ticket -------------------------------------------------------
  const [direction, setDirection] = useState<"long" | "short">("long")
  const [stopPrice, setStopPrice] = useState("")
  const [takeProfit, setTakeProfit] = useState("")
  const [tags, setTags] = useState("")

  /** Appends a suggested tag, skipping one that is already present. */
  const addTag = useCallback((tag: string) => {
    setTags((prev) => {
      const existing = prev
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
      if (existing.includes(tag.toLowerCase())) return prev
      return prev.trim() === "" ? tag : `${prev.replace(/,\s*$/, "")}, ${tag}`
    })
  }, [])

  // The price at the server-authoritative cursor. Used for display and for
  // marking the open position to market; the server recomputes it from the
  // same candle when the position actually closes.
  const currentPrice = current?.close ?? null

  const unrealized = useMemo(() => {
    if (!openPosition || currentPrice === null) return null
    return computeUnrealized({
      direction: openPosition.direction,
      entryPrice: openPosition.entryPrice,
      stopPrice: openPosition.stopPrice,
      quantity: openPosition.quantity,
      currentPrice,
    })
  }, [openPosition, currentPrice])

  const entryPrice = current?.close ?? null
  const stop = stopPrice.trim() === "" ? null : Number(stopPrice)
  const target = takeProfit.trim() === "" ? null : Number(takeProfit)

  const levelErrors = useMemo(() => {
    if (entryPrice === null) return {}
    return validateLevels({
      direction,
      entryPrice,
      stopPrice: stop,
      takeProfit: target,
    })
  }, [direction, entryPrice, stop, target])

  // Preview only. The server recomputes this with the same helper before
  // writing, so the browser cannot influence the size that is stored.
  const quantity = useMemo(() => {
    if (entryPrice === null) return null
    return computePositionSize({
      direction,
      entryPrice,
      stopPrice: stop,
      balance,
      riskPercent,
    })
  }, [direction, entryPrice, stop, balance, riskPercent])

  const riskAmount = (balance * riskPercent) / 100

  async function submitOpen(formData: FormData) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await openReplayPosition(initialBacktestState, formData)
      if (result.error) {
        setError(result.error)
      } else {
        setStopPrice("")
        setTakeProfit("")
        setTags("")
        setNotice("Position opened. Advance the replay to see how it resolves.")
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-0">
        <CardContent className="p-0">
          <ReplayChart candles={visible} />
        </CardContent>
      </Card>

      {/* Transport */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <Button
            onClick={() => setPlaying((p) => !p)}
            disabled={atEnd || busy}
            size="sm"
            aria-label={isPlaying ? "Pause replay" : "Play replay"}
          >
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
            {isPlaying ? "Pause" : "Play"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void advance(1)}
            disabled={atEnd || busy}
            aria-label="Step forward one candle"
          >
            <ChevronRight className="size-4" />
            Step
          </Button>

          <form
            action={async (fd) => {
              fd.set("id", replay.id)
              await resetReplay(fd)
              setCursorTs(replay.rangeStart)
              setPlaying(false)
              setAtEnd(false)
              setNotice(null)
              router.refresh()
            }}
          >
            <Button type="submit" variant="ghost" size="sm">
              <RotateCcw className="size-4" />
              Reset
            </Button>
          </form>

          <div className="flex items-center gap-2">
            <Label htmlFor="speed" className="text-xs text-muted-foreground">
              Speed
            </Label>
            <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
              <SelectTrigger id="speed" className="h-9 w-[90px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEEDS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <Badge variant="outline">{visible.length} bars shown</Badge>
            {current && (
              <span className="font-mono tabular-nums text-muted-foreground">
                {new Date(current.ts).toLocaleString()} · {current.close}
              </span>
            )}
            {atEnd && (
              <Badge
                variant="outline"
                className="border-primary/30 bg-primary/10 text-primary"
              >
                End of range
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {notice && (
        <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
          {notice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      )}

      {openPosition ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <span
                className={cn(
                  "uppercase tracking-wide",
                  openPosition.direction === "long"
                    ? "text-positive"
                    : "text-negative",
                )}
              >
                Open {openPosition.direction}
              </span>
              <span className="text-muted-foreground">{openPosition.symbol}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {[
                ["Entry", String(openPosition.entryPrice)],
                [
                  "Current",
                  /* From the bar at the server-side cursor, not a browser
                     quote — the client has no authoritative price. */
                  currentPrice === null ? "—" : String(currentPrice),
                ],
                ["Stop", openPosition.stopPrice ?? "—"],
                ["Target", openPosition.takeProfit ?? "—"],
                ["Size", String(openPosition.quantity)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="font-mono text-sm tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Unrealized P&L
                </dt>
                <dd
                  className={cn(
                    "font-mono text-sm tabular-nums",
                    unrealized && unrealized.pnl > 0 && "text-positive",
                    unrealized && unrealized.pnl < 0 && "text-negative",
                  )}
                >
                  {unrealized
                    ? formatCurrency(unrealized.pnl, { signed: true })
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Current R
                </dt>
                <dd
                  className={cn(
                    "font-mono text-sm tabular-nums",
                    unrealized?.rMultiple != null &&
                      unrealized.rMultiple > 0 &&
                      "text-positive",
                    unrealized?.rMultiple != null &&
                      unrealized.rMultiple < 0 &&
                      "text-negative",
                  )}
                >
                  {unrealized?.rMultiple == null
                    ? "—"
                    : `${unrealized.rMultiple > 0 ? "+" : ""}${unrealized.rMultiple.toFixed(2)}R`}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Risk
                </dt>
                <dd className="font-mono text-sm tabular-nums">
                  {unrealized?.riskAmount == null
                    ? "—"
                    : formatCurrency(unrealized.riskAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Equity
                </dt>
                <dd className="font-mono text-sm tabular-nums">
                  {unrealized
                    ? formatCurrency(balance + unrealized.pnl)
                    : formatCurrency(balance)}
                </dd>
                <dd className="text-[10px] text-muted-foreground">
                  balance {formatCurrency(balance)}
                </dd>
              </div>
            </dl>

            <p className="text-xs text-muted-foreground">
              Unrealized figures are marked to the current candle and are not
              part of realised session statistics until the position closes.
              The engine closes it automatically when a candle reaches the stop
              or the target; if one candle touches both, the stop is taken,
              because a bar records only its high and low, never the order they
              occurred in.
            </p>

            <form action={closeReplayPosition}>
              <input type="hidden" name="replayId" value={replay.id} />
              <Button type="submit" variant="outline" size="sm">
                Close position
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Place a trade</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={submitOpen} className="flex flex-col gap-4">
              <input type="hidden" name="replayId" value={replay.id} />
              <input type="hidden" name="direction" value={direction} />

              <div className="flex flex-wrap items-end gap-3">
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={direction === "long" ? "default" : "outline"}
                    onClick={() => setDirection("long")}
                    className={cn(
                      direction === "long" &&
                        "bg-positive text-background hover:bg-positive/90",
                    )}
                  >
                    <TrendingUp className="size-4" />
                    Long
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={direction === "short" ? "default" : "outline"}
                    onClick={() => setDirection("short")}
                    className={cn(
                      direction === "short" &&
                        "bg-negative text-background hover:bg-negative/90",
                    )}
                  >
                    <TrendingDown className="size-4" />
                    Short
                  </Button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="stopPrice" className="text-xs">
                    Stop loss
                  </Label>
                  <Input
                    id="stopPrice"
                    name="stopPrice"
                    type="number"
                    step="any"
                    min="0"
                    value={stopPrice}
                    onChange={(e) => setStopPrice(e.target.value)}
                    placeholder="Required"
                    className="h-9 w-[160px]"
                    aria-invalid={Boolean(levelErrors.stopPrice)}
                  />
                  {levelErrors.stopPrice && (
                    <p className="text-xs text-negative">
                      {levelErrors.stopPrice}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="takeProfit" className="text-xs">
                    Take profit
                  </Label>
                  <Input
                    id="takeProfit"
                    name="takeProfit"
                    type="number"
                    step="any"
                    min="0"
                    value={takeProfit}
                    onChange={(e) => setTakeProfit(e.target.value)}
                    placeholder="Optional"
                    className="h-9 w-[160px]"
                    aria-invalid={Boolean(levelErrors.takeProfit)}
                  />
                  {levelErrors.takeProfit && (
                    <p className="text-xs text-negative">
                      {levelErrors.takeProfit}
                    </p>
                  )}
                </div>
              </div>

              {/* Classification. Optional — a trader should not be forced to
                  grade every trade — but recorded before the position opens so
                  the analytics breakdown has something to group by. */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="strategyId" className="text-xs">
                    Strategy
                  </Label>
                  <Select name="strategyId" defaultValue="none">
                    <SelectTrigger id="strategyId" className="h-9">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No strategy</SelectItem>
                      {strategies.map((st) => (
                        <SelectItem key={st.id} value={st.id}>
                          {st.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="setup" className="text-xs">
                    Setup
                  </Label>
                  <Select name="setup" defaultValue="none">
                    <SelectTrigger id="setup" className="h-9">
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

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="marketSession" className="text-xs">
                    Market session
                  </Label>
                  <Select name="marketSession" defaultValue="none">
                    <SelectTrigger id="marketSession" className="h-9">
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

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tags" className="text-xs">
                    Tags
                  </Label>
                  <Input
                    id="tags"
                    name="tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="FVG, liquidity sweep"
                    className="h-9"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {SUGGESTED_TAGS.map((tag) => (
                  <Button
                    key={tag}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs font-normal"
                    onClick={() => addTag(tag)}
                  >
                    + {tag}
                  </Button>
                ))}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="notes" className="text-xs">
                  Notes
                </Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={2}
                  placeholder="4H bias bearish, 15M FVG, liquidity sweep before entry."
                />
              </div>

              <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-muted/20 p-3 text-xs">
                <span className="text-muted-foreground">
                  Entry{" "}
                  <span className="font-mono text-foreground">
                    {entryPrice ?? "—"}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Risk{" "}
                  <span className="font-mono text-foreground">
                    {formatCurrency(riskAmount)} ({riskPercent}%)
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Size{" "}
                  <span className="font-mono text-foreground">
                    {quantity ?? "—"}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Target className="size-3.5" />
                  Exit is decided by the market, not entered by you.
                </span>
              </div>

              <div>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    quantity === null ||
                    entryPrice === null ||
                    Object.keys(levelErrors).length > 0
                  }
                  className={cn(
                    direction === "long"
                      ? "bg-positive text-background hover:bg-positive/90"
                      : "bg-negative text-background hover:bg-negative/90",
                  )}
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  Open {direction}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
