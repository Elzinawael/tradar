import { Suspense } from "react"
import type { Metadata } from "next"
import { ShieldAlert } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { CandleImport } from "@/components/replay/candle-import"
import {
  InstrumentCatalog,
  type CatalogRow,
} from "@/components/market-data/instrument-catalog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getCandleCatalog, getIsAdmin } from "@/lib/data"
import { searchInstruments, getListingsFor } from "@/lib/market-data/registry"
import { getBestProvider } from "@/lib/market-data/router"
import type { MarketCategory } from "@/lib/market-data/types"
import { MARKET_CATEGORIES } from "@/lib/market-data/types"

export const metadata: Metadata = { title: "Market data" }

export default async function MarketDataPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>
}) {
  const { q, category } = await searchParams
  const validCategory = MARKET_CATEGORIES.includes(category as MarketCategory)
    ? (category as MarketCategory)
    : undefined

  const [instruments, catalog, isAdmin] = await Promise.all([
    searchInstruments({ search: q, category: validCategory }),
    getCandleCatalog(),
    getIsAdmin(),
  ])

  const listings = await getListingsFor(instruments.map((i) => i.id))

  // Stored bar counts, summed across timeframes, so a customer can see at a
  // glance whether anything has been downloaded for an instrument.
  const stored = new Map<string, number>()
  for (const entry of catalog) {
    stored.set(entry.symbol, (stored.get(entry.symbol) ?? 0) + entry.count)
  }

  const rows: CatalogRow[] = instruments.map((instrument) => {
    const own = listings.get(instrument.id) ?? []
    // H1 is the representative timeframe for the availability badge; the
    // per-timeframe answer is resolved when a replay is actually created.
    const route = getBestProvider(instrument, own, "H1")
    const bars = stored.get(instrument.symbol) ?? 0

    return {
      symbol: instrument.symbol,
      displayName: instrument.displayName,
      category: instrument.category,
      exchange: instrument.exchange,
      // Imported data counts as a source even with no live provider — that is
      // exactly what the CSV fallback is for.
      available: route.ok || bars > 0,
      source: route.ok
        ? route.provider.capabilities.label
        : bars > 0
          ? "Imported data"
          : null,
      storedBars: bars,
    }
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Market data"
        description="Instruments Tradar can replay. Data is downloaded automatically where a source is configured."
      />

      <Suspense fallback={<div className="h-9" />}>
        <InstrumentCatalog rows={rows} />
      </Suspense>

      {/*
        CSV import is an administrator/fallback tool, not the customer
        workflow. It stays available for private data and instruments with no
        configured provider.
      */}
      {isAdmin ? (
        <div className="space-y-4 border-t border-border pt-6">
          <div>
            <h2 className="text-sm font-semibold">Advanced: manual import</h2>
            <p className="text-sm text-muted-foreground">
              For private data, or instruments with no configured provider.
            </p>
          </div>
          <CandleImport />
        </div>
      ) : (
        <Card className="border-t border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Manual import
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Market data is managed by an administrator on this instance. You
              can replay any instrument listed above that has a source.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
