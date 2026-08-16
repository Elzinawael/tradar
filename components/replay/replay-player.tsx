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
} from "lucide-react"
import { ReplayChart } from "./replay-chart"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { advanceCursor, visibleCandles, type Candle } from "@/lib/candles"
import { computePositionSize } from "@/lib/trade-math"
import { placeReplayTrade } from "@/lib/actions/replay"
import { setReplayCursor } from "@/lib/actions/replay"
import { cn, formatCurrency } from "@/lib/utils"
import type { ReplaySession } from "@/lib/types"

const SPEEDS = [0.5, 1, 2, 5, 10, 25]

interface ReplayPlayerProps {
  replay: ReplaySession
  /**
   * Bars for the whole selected range.
   *
   * Prefetched so playback is smooth — a round trip per bar would make replay
   * unusable. Only bars at or before the cursor are ever rendered, and the
   * cursor is authoritative in the database, so this cannot be used to advance
   * the replay past its range. A user can still inspect this payload in
   * devtools; that is their own backtest data, and look-ahead prevention here
   * is a discipline aid rather than an adversarial control.
   */
  candles: Candle[]
  /** Session equity used for risk-based sizing. */
  balance: number
  riskPercent: number
}

export function ReplayPlayer({
  replay,
  candles,
  balance,
  riskPercent,
}: ReplayPlayerProps) {
  const router = useRouter()
  const [cursorTs, setCursorTs] = useState(replay.cursorTs)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(replay.speed || 1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const visible = useMemo(
    () => visibleCandles(candles, cursorTs),
    [candles, cursorTs],
  )
  const current = visible[visible.length - 1] ?? null
  const atEnd = visible.length >= candles.length

  const step = useCallback(
    (bars: number) => {
      setCursorTs((prev) => advanceCursor(candles, prev, bars).cursorTs)
    },
    [candles],
  )

  // Playback loop. The interval is derived from speed; at 1x a bar appears
  // every 1000ms. Reaching the end of the range stops the loop by making the
  // effect bail out, rather than by setting state from inside it.
  const isPlaying = playing && !atEnd

  useEffect(() => {
    if (!isPlaying) return
    const id = window.setInterval(() => step(1), Math.max(40, 1000 / speed))
    return () => window.clearInterval(id)
  }, [isPlaying, speed, step])

  // Persist the cursor when it settles, so reopening the replay resumes where
  // it left off. Debounced to avoid a write per bar during fast playback.
  const persistTimer = useRef<number | null>(null)
  useEffect(() => {
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      const body = new FormData()
      body.set("id", replay.id)
      body.set("cursorTs", cursorTs)
      void setReplayCursor(body)
    }, 800)
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current)
    }
  }, [cursorTs, replay.id])

  // --- order ticket -------------------------------------------------------
  const [direction, setDirection] = useState<"long" | "short">("long")
  const [stopPrice, setStopPrice] = useState("")
  const [takeProfit, setTakeProfit] = useState("")

  const entryPrice = current?.close ?? null
  const stop = stopPrice.trim() === "" ? null : Number(stopPrice)

  // Size is derived, never typed: risk % of session equity divided by the
  // distance to the stop. Returns null when sizing is undefined.
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

  async function submitTrade(formData: FormData) {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await placeReplayTrade(
        { error: null, fieldErrors: {} },
        formData,
      )
      if (result.error) {
        setError(result.error)
      } else {
        setNotice("Trade recorded in the session.")
        setStopPrice("")
        setTakeProfit("")
        router.refresh()
      }
    } finally {
      setSaving(false)
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
            disabled={atEnd}
            size="sm"
            aria-label={isPlaying ? "Pause replay" : "Play replay"}
          >
            {isPlaying ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
            {isPlaying ? "Pause" : "Play"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => step(1)}
            disabled={atEnd}
            aria-label="Step forward one candle"
          >
            <ChevronRight className="size-4" />
            Step
          </Button>

          <form
            action={async (fd) => {
              fd.set("id", replay.id)
              const { resetReplay } = await import("@/lib/actions/replay")
              await resetReplay(fd)
              setCursorTs(replay.rangeStart)
              setPlaying(false)
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
            <Select
              value={String(speed)}
              onValueChange={(v) => setSpeed(Number(v))}
            >
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
            <Badge variant="outline">
              {visible.length} / {candles.length} bars
            </Badge>
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

      {/* Order ticket */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Place a trade</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={submitTrade} className="flex flex-col gap-4">
            <input type="hidden" name="replayId" value={replay.id} />
            <input type="hidden" name="direction" value={direction} />
            <input
              type="hidden"
              name="quantity"
              value={quantity ?? ""}
            />

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
                  placeholder="Required for sizing"
                  className="h-9 w-[150px]"
                />
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
                  className="h-9 w-[150px]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="exitPrice" className="text-xs">
                  Exit price
                </Label>
                <Input
                  id="exitPrice"
                  name="exitPrice"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Blank if open"
                  className="h-9 w-[150px]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="closedAt" className="text-xs">
                  Exit time
                </Label>
                <Input
                  id="closedAt"
                  name="closedAt"
                  type="datetime-local"
                  className="h-9 w-[210px]"
                />
              </div>
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
              {quantity === null && (
                <span className="text-muted-foreground">
                  Set a stop on the losing side of entry to size the position.
                </span>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-foreground"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div className="rounded-md border border-positive/30 bg-positive/10 p-3 text-xs text-positive">
                {notice}
              </div>
            )}

            <div>
              <Button
                type="submit"
                disabled={saving || quantity === null || entryPrice === null}
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                Record {direction} trade
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
