import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { ExternalLink, Trash2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { ReplayPlayer } from "@/components/replay/replay-player"
import { TradeTable } from "@/components/trades/trade-table"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  getBacktestSessionById,
  getCandles,
  getOpenReplayPosition,
  getReplaySessionById,
  getSessionPerformance,
  getSimulatedTrades,
} from "@/lib/data"
import { deleteReplaySession } from "@/lib/actions/replay"
import { formatCurrency, formatPercent } from "@/lib/utils"

export const metadata: Metadata = { title: "Replay" }

export default async function ReplayDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const replay = await getReplaySessionById(id)
  if (!replay) notFound()

  const session = await getBacktestSessionById(replay.sessionId)
  if (!session) notFound()

  const [candles, trades, openPosition] = await Promise.all([
    // Bounded to the replay's own window: candles outside the selected range
    // are never fetched, so they cannot reach the client at all.
    getCandles({
      symbol: replay.symbol,
      timeframe: replay.timeframe,
      from: replay.rangeStart,
      to: replay.rangeEnd,
      limit: 20000,
    }),
    getSimulatedTrades(session.id),
    getOpenReplayPosition(replay.id),
  ])

  const { summary } = await getSessionPerformance(session, trades)

  // Equity available to risk against: the session's balance as it stands.
  const balance = summary.accountBalance || session.initialBalance
  const riskPercent = session.riskPerTrade > 0 ? session.riskPerTrade : 1

  const replayTrades = trades.filter((t) => t.sessionId === session.id)

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${replay.symbol} replay`}
        description={`${replay.timeframe} · ${new Date(replay.rangeStart).toLocaleDateString()} — ${new Date(replay.rangeEnd).toLocaleDateString()}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/backtesting/sessions/${session.id}`}>
                <ExternalLink className="size-4" />
                {session.name}
              </Link>
            </Button>
            <form action={deleteReplaySession}>
              <input type="hidden" name="id" value={replay.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-negative hover:bg-negative/10 hover:text-negative"
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            </form>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Session equity"
          value={formatCurrency(balance)}
          hint={`from ${formatCurrency(session.initialBalance)}`}
        />
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
          label="Win rate"
          value={summary.winRate === null ? "—" : formatPercent(summary.winRate)}
          hint={`${summary.tradeCount} closed`}
        />
        <MetricCard
          label="Risk per trade"
          value={`${riskPercent}%`}
          hint={formatCurrency((balance * riskPercent) / 100)}
        />
      </div>

      {candles.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            No candles found for {replay.symbol} {replay.timeframe} in this
            range.{" "}
            <Link
              href="/replay/data"
              className="text-primary underline-offset-2 hover:underline"
            >
              Import market data
            </Link>{" "}
            covering these dates.
          </p>
        </Card>
      ) : (
        <ReplayPlayer
          replay={replay}
          candles={candles}
          balance={balance}
          riskPercent={riskPercent}
          openPosition={openPosition}
        />
      )}

      <Card className="p-0">
        <TradeTable
          trades={replayTrades}
          sort="opened_at"
          order="asc"
          buildSortHref={() => `/replay/${replay.id}`}
          hrefFor={(trade) =>
            `/backtesting/sessions/${session.id}/trades/${trade.id}`
          }
          emptyTitle="No trades in this session yet"
          emptyDescription="Trades you place during replay appear here and in the session's statistics."
        />
      </Card>
    </div>
  )
}
