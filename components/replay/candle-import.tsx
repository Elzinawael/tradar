"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, Check, Download, FileUp, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  importCandlesCsv,
  importCandlesFromBinance,
} from "@/lib/actions/candles"
import {
  initialCandleImportState,
  type CandleImportState,
} from "@/lib/actions/state"
import { TIMEFRAMES, TIMEFRAME_LABELS } from "@/lib/candles"

function SubmitButton({ label, icon }: { label: string; icon: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : icon}
      {label}
    </Button>
  )
}

function Feedback({ state }: { state: CandleImportState }) {
  if (state.error) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-foreground"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span>{state.error}</span>
      </div>
    )
  }
  if (state.message) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-positive/30 bg-positive/10 p-3 text-xs text-positive">
        <Check className="mt-0.5 size-4 shrink-0" />
        <span>{state.message}</span>
      </div>
    )
  }
  return null
}

function TimeframeSelect({ id }: { id: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Timeframe</Label>
      <Select name="timeframe" defaultValue="H1">
        <SelectTrigger id={id}>
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
  )
}

export function CandleImport() {
  const [csv, setCsv] = useState("")
  const [fileName, setFileName] = useState("")

  const [csvState, csvAction] = useActionState<CandleImportState, FormData>(
    importCandlesCsv,
    initialCandleImportState,
  )
  const [binanceState, binanceAction] = useActionState<
    CandleImportState,
    FormData
  >(importCandlesFromBinance, initialCandleImportState)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsv(await file.text())
    setFileName(file.name)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Import candles from CSV
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={csvAction} className="flex flex-col gap-4">
            <input type="hidden" name="csv" value={csv} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="csv-symbol">Symbol</Label>
                <Input
                  id="csv-symbol"
                  name="symbol"
                  placeholder="EURUSD"
                  required
                />
              </div>
              <TimeframeSelect id="csv-timeframe" />
            </div>

            <label
              htmlFor="candle-file"
              className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <FileUp className="size-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {fileName || "Select a candle CSV"}
              </span>
            </label>
            <input
              id="candle-file"
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="sr-only"
            />

            <p className="text-xs text-muted-foreground">
              Columns in order: timestamp, open, high, low, close, volume
              (volume optional). Timestamps may be ISO 8601 or a Unix epoch.
              Re-importing a range corrects existing bars instead of
              duplicating them.
            </p>

            <Feedback state={csvState} />

            <div>
              <SubmitButton label="Import CSV" icon={<FileUp className="size-4" />} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Fetch crypto candles from Binance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={binanceAction} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="binance-symbol">Pair</Label>
                <Input
                  id="binance-symbol"
                  name="symbol"
                  placeholder="BTCUSDT"
                  required
                />
              </div>
              <TimeframeSelect id="binance-timeframe" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="binance-from">From</Label>
                <Input id="binance-from" name="from" type="date" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="binance-to">To</Label>
                <Input id="binance-to" name="to" type="date" />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Binance&apos;s public endpoint needs no API key or account. Crypto
              pairs only, written in Binance&apos;s format such as BTCUSDT.
            </p>

            <Feedback state={binanceState} />

            <div>
              <SubmitButton
                label="Fetch from Binance"
                icon={<Download className="size-4" />}
              />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
