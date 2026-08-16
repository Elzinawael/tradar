import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { CandleImport } from "@/components/replay/candle-import"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ShieldAlert } from "lucide-react"
import { getCandleCatalog, getIsAdmin } from "@/lib/data"

export const metadata: Metadata = { title: "Market data" }

export default async function MarketDataPage() {
  const [catalog, isAdmin] = await Promise.all([
    getCandleCatalog(),
    getIsAdmin(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Market data"
        description="Historical candles available for replay. Shared across every replay on this instance."
      />

      {isAdmin ? (
        <CandleImport />
      ) : (
        /*
          Presentation only. The database rejects import_candles() for
          non-administrators, so this panel explains the restriction rather
          than enforcing it.
        */
        <Card>
          <CardContent className="flex items-start gap-3 pt-6">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                Market data is managed by an administrator
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Candles are shared by everyone on this instance, so importing
                them is restricted. You can replay any data listed below.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {catalog.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Loaded data</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {catalog.map((entry) => (
                <li
                  key={`${entry.symbol}-${entry.timeframe}`}
                  className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0"
                >
                  <div>
                    <span className="text-sm font-medium">{entry.symbol}</span>
                    <Badge variant="outline" className="ml-2">
                      {entry.timeframe}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {entry.count.toLocaleString()} bars ·{" "}
                    {new Date(entry.first).toLocaleDateString()} —{" "}
                    {new Date(entry.last).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
