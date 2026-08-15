import Link from "next/link"
import type { Metadata } from "next"
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { EmptyState } from "@/components/empty-state"
import { TradeTable } from "@/components/trades/trade-table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getDayDetail } from "@/lib/data"
import { formatDuration } from "@/lib/trade-math"
import { formatCurrency, formatPercent } from "@/lib/utils"

export const metadata: Metadata = { title: "Day view" }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function todayKey(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Shifts a YYYY-MM-DD key by whole days without UTC drift. */
function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number)
  const date = new Date(y, m - 1, d + days)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export default async function DayViewPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date } = await searchParams
  const active = date && ISO_DATE.test(date) ? date : todayKey()

  const { trades, summary, journal } = await getDayDetail(active)

  const label = new Date(`${active}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Day view"
        description={label}
        actions={
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon" className="size-9">
              <Link
                href={`/day-view?date=${shiftDay(active, -1)}`}
                aria-label="Previous day"
              >
                <ChevronLeft className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/day-view">Today</Link>
            </Button>
            <Button asChild variant="outline" size="icon" className="size-9">
              <Link
                href={`/day-view?date=${shiftDay(active, 1)}`}
                aria-label="Next day"
              >
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </div>
        }
      />

      {trades.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No trades on this day"
          description="Use the arrows to move between days, or log a trade for this session."
          action={
            <Button asChild>
              <Link href="/trades/new">Log a trade</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Net P&L"
              value={formatCurrency(summary.netPnl, { signed: true })}
              tone={
                summary.netPnl > 0
                  ? "positive"
                  : summary.netPnl < 0
                    ? "negative"
                    : "default"
              }
            />
            <MetricCard
              label="Trades"
              value={String(trades.length)}
              hint={`${summary.tradeCount} closed`}
            />
            <MetricCard
              label="Win rate"
              value={
                summary.winRate === null ? "—" : formatPercent(summary.winRate)
              }
            />
            <MetricCard
              label="Average hold"
              value={formatDuration(summary.averageHoldMinutes)}
            />
          </div>

          <Card className="p-0">
            <TradeTable
              trades={trades}
              sort="opened_at"
              order="asc"
              buildSortHref={() => `/day-view?date=${active}`}
            />
          </Card>
        </>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold">
            Journal for this day
          </CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link href={`/journal?date=${active}`}>
              {journal ? "Edit entry" : "Write entry"}
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {!journal ? (
            <EmptyState
              icon={BookOpen}
              title="No journal entry"
              description="Record what you planned and what actually happened."
              compact
            />
          ) : (
            <dl className="flex flex-col gap-3 text-sm">
              {[
                ["Pre-market plan", journal.preMarketPlan],
                ["Session notes", journal.sessionNotes],
                ["Post-market review", journal.postMarketReview],
                ["Lessons", journal.lessons],
              ]
                .filter(([, value]) => Boolean(value))
                .map(([title, value]) => (
                  <div key={title}>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {title}
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap">{value}</dd>
                  </div>
                ))}
              {journal.mood && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Mood
                  </dt>
                  <dd className="mt-1">{journal.mood}</dd>
                </div>
              )}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
