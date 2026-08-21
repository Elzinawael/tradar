"use client"

import { useCallback, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Check, Database, Search, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/empty-state"
import {
  MARKET_CATEGORIES,
  MARKET_CATEGORY_LABELS,
  type MarketCategory,
} from "@/lib/market-data/types"

export interface CatalogRow {
  symbol: string
  displayName: string
  category: MarketCategory
  exchange: string | null
  /** True when a configured provider, or already-imported data, can serve it. */
  available: boolean
  /** Human label for the source, or null when unavailable. */
  source: string | null
  storedBars: number
}

/**
 * Instrument catalogue.
 *
 * Search and category live in the URL, so the list stays server-rendered and a
 * filtered view is shareable — the same pattern the trades and session filters
 * already use.
 *
 * Availability is computed server-side by the market data service. A row
 * showing "No source" means Tradar can represent the instrument but no
 * configured provider lists it yet — which is a different statement from "this
 * market does not exist", and worth showing rather than hiding.
 */
export function InstrumentCatalog({ rows }: { rows: CatalogRow[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (!value) params.delete(key)
      else params.set(key, value)
      startTransition(() => router.push(`${pathname}?${params.toString()}`))
    },
    [pathname, router, searchParams],
  )

  const activeCategory = searchParams.get("category") ?? ""
  const hasFilters = Boolean(activeCategory || searchParams.get("q"))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault()
            const input = e.currentTarget.elements.namedItem(
              "q",
            ) as HTMLInputElement | null
            setParam("q", input?.value.trim() ?? "")
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={searchParams.get("q") ?? ""}
            placeholder="Search instruments…"
            aria-label="Search instruments"
            className="h-9 w-[240px] pl-8"
          />
        </form>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => startTransition(() => router.push(pathname))}
          >
            <X className="size-4" />
            Clear
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {MARKET_CATEGORIES.map((category) => (
          <Button
            key={category}
            type="button"
            variant={activeCategory === category ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() =>
              setParam("category", activeCategory === category ? "" : category)
            }
          >
            {MARKET_CATEGORY_LABELS[category]}
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No instruments match"
          description="Try a different search term or category."
          compact
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.symbol}>
              <CardContent className="flex items-start justify-between gap-3 pt-6">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{row.symbol}</span>
                    <Badge variant="outline" className="font-normal">
                      {MARKET_CATEGORY_LABELS[row.category]}
                    </Badge>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {row.displayName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.storedBars > 0
                      ? `${row.storedBars.toLocaleString()} bars stored`
                      : "No data stored yet"}
                    {row.exchange ? ` · ${row.exchange}` : ""}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  {row.available ? (
                    <Badge
                      variant="outline"
                      className="border-positive/30 bg-positive/10 text-positive"
                    >
                      <Check className="mr-1 size-3" />
                      {row.source}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      No source
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
