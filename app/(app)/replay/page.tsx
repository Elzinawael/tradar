import Link from "next/link"
import type { Metadata } from "next"
import { Database, History, Plus } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getCandleCatalog, getIsAdmin, getReplaySessions } from "@/lib/data"

export const metadata: Metadata = { title: "Trade Replay" }

export default async function ReplayPage() {
  const [replays, catalog, isAdmin] = await Promise.all([
    getReplaySessions(),
    getCandleCatalog(),
    getIsAdmin(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trade Replay"
        description="Step through history bar by bar and trade it as if it were live."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/replay/data">
                <Database className="size-4" />
                Market data
              </Link>
            </Button>
            <Button asChild size="sm" disabled={catalog.length === 0}>
              <Link href="/replay/new">
                <Plus className="size-4" />
                New replay
              </Link>
            </Button>
          </div>
        }
      />

      {catalog.length === 0 && (
        <EmptyState
          icon={Database}
          title="No market data loaded"
          description={
            isAdmin
              ? "Replay needs historical candles. Import a CSV from your broker, or pull crypto candles from Binance — no API key required."
              : "Replay needs historical candles, and market data is managed by an administrator on this instance. Ask them to load the symbol you need."
          }
          action={
            isAdmin ? (
              <Button asChild>
                <Link href="/replay/data">Load market data</Link>
              </Button>
            ) : undefined
          }
        />
      )}

      {catalog.length > 0 && replays.length === 0 && (
        <EmptyState
          icon={History}
          title="No replays yet"
          description="Start a replay against a backtest session. Trades you place will flow into that session's equity curve."
          action={
            <Button asChild>
              <Link href="/replay/new">Start a replay</Link>
            </Button>
          }
        />
      )}

      {replays.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {replays.map((replay) => {
            const total =
              new Date(replay.rangeEnd).getTime() -
              new Date(replay.rangeStart).getTime()
            const done =
              new Date(replay.cursorTs).getTime() -
              new Date(replay.rangeStart).getTime()
            const percent =
              total > 0 ? Math.round((done / total) * 100) : 0

            return (
              <Card key={replay.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-semibold">
                      <Link
                        href={`/replay/${replay.id}`}
                        className="underline-offset-2 hover:text-primary hover:underline"
                      >
                        {replay.symbol}
                      </Link>
                    </CardTitle>
                    <Badge variant="outline">{replay.timeframe}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(replay.rangeStart).toLocaleDateString()} —{" "}
                    {new Date(replay.rangeEnd).toLocaleDateString()}
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Replay progress"
                  >
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {percent}% through the range
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {catalog.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Available market data
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {catalog.map((entry) => (
                <li
                  key={`${entry.symbol}-${entry.timeframe}`}
                  className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0"
                >
                  <div>
                    <span className="text-sm font-medium">{entry.symbol}</span>{" "}
                    <Badge variant="outline" className="ml-1">
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
