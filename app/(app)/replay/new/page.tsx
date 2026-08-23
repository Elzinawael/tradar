import Link from "next/link"
import type { Metadata } from "next"
import { FlaskConical } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import {
  NewReplayForm,
  type InstrumentOption,
} from "@/components/replay/new-replay-form"
import { getBacktestSessionList, getCandleCatalog } from "@/lib/data"
import { searchInstruments, getListingsFor } from "@/lib/market-data/registry"
import { hasAnyHistoricalSource } from "@/lib/market-data/router"

export const metadata: Metadata = { title: "New replay" }

export default async function NewReplayPage() {
  const [sessions, instruments, catalog] = await Promise.all([
    getBacktestSessionList(),
    searchInstruments({ limit: 200 }),
    getCandleCatalog(),
  ])

  if (sessions.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="New replay"
          description="A replay records its trades into a backtest session."
        />
        <EmptyState
          icon={FlaskConical}
          title="No backtest session yet"
          description="Replay trades belong to a session so they roll into its equity curve and statistics."
          action={
            <Button asChild>
              <Link href="/backtesting/sessions/new">Create a session</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const listings = await getListingsFor(instruments.map((i) => i.id))

  const stored = new Map<string, number>()
  for (const entry of catalog) {
    stored.set(entry.symbol, (stored.get(entry.symbol) ?? 0) + entry.count)
  }

  // An instrument is offered when a configured provider can fetch it OR data
  // has already been imported for it. Unavailable ones are still listed, so a
  // customer can see the market exists and is simply not sourced yet.
  const options: InstrumentOption[] = instruments.map((instrument) => {
    const bars = stored.get(instrument.symbol) ?? 0
    return {
      symbol: instrument.symbol,
      displayName: instrument.displayName,
      category: instrument.category,
      available:
        hasAnyHistoricalSource(instrument, listings.get(instrument.id) ?? []) ||
        bars > 0,
      storedBars: bars,
    }
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="New replay"
        description="Pick a market and a period. Tradar obtains the historical data for you."
      />
      <NewReplayForm sessions={sessions} instruments={options} />
    </div>
  )
}
