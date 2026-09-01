import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { ExternalLink, Trash2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { ReplayPlayer } from "@/components/replay/replay-player"
import { TradeTable } from "@/components/trades/trade-table"
import { ReplayPerformance } from "@/components/replay/replay-performance"
import { ReplayOrders } from "@/components/replay/replay-orders"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  getBacktestSessionById,
  getCandles,
  getCandleRangeStats,
  getOpenReplayPosition,
  getPendingReplayOrder,
  getReplayOrders,
  getStrategies,
  getReplaySessionById,
  getSessionPerformance,
  getSimulatedTrades,
} from "@/lib/data"
import { breadcrumbTrail } from "@/lib/navigation"
import { isTimeframe } from "@/lib/candles"
import { assessCoverage, coverageFromStats } from "@/lib/replay/dataset"
import {
  replayWindowStart,
  REPLAY_WINDOW_MAX_BARS,
} from "@/lib/replay/window"
import { getInstrumentBySymbol } from "@/lib/market-data/registry"
import { resolvePricePrecision } from "@/lib/smart-input/instrument-config"
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

  const timeframe = isTimeframe(replay.timeframe) ? replay.timeframe : "H1"

  // WINDOWED LOAD. Only bars from a bounded lookback up to the cursor reach the
  // client — a 90-day M1 replay is ~130k bars and must not be sent whole. The
  // player extends this window forward as the replay advances (advanceReplay
  // returns the revealed bars). No bar after the cursor is ever loaded.
  const windowStart = replayWindowStart(
    replay.cursorTs,
    replay.rangeStart,
    timeframe,
  )

  const [candles, rangeStats, trades, openPosition, strategies, pendingOrder, orders, instrument] =
    await Promise.all([
    getCandles({
      symbol: replay.symbol,
      timeframe: replay.timeframe,
      from: windowStart,
      until: replay.cursorTs,
      limit: REPLAY_WINDOW_MAX_BARS,
    }),
    // Cheap: count + first/last bar for the WHOLE range, to check the dataset
    // against the fingerprint stored at creation without loading it all.
    getCandleRangeStats({
      symbol: replay.symbol,
      timeframe: replay.timeframe,
      from: replay.rangeStart,
      to: replay.rangeEnd,
    }),
    getSimulatedTrades(session.id),
    getOpenReplayPosition(replay.id),
    getStrategies(),
    getPendingReplayOrder(replay.id),
    getReplayOrders(replay.id),
    // Registry metadata for price-field precision (display only). May be null
    // for a CSV-imported symbol; a data-derived fallback covers that.
    getInstrumentBySymbol(replay.symbol),
  ])

  const pricePrecision = resolvePricePrecision(
    instrument?.pricePrecision,
    candles.slice(-200).map((c) => c.close),
  )

  // Coverage of the WHOLE replay range. New replays are verified complete at
  // creation and carry a bar-count fingerprint; for those, cheap range stats
  // are enough. Legacy replays (no fingerprint) get the full candle-level
  // check so interior holes are still caught.
  let coverage: ReturnType<typeof assessCoverage> | null = null
  if (isTimeframe(replay.timeframe)) {
    if (replay.datasetBars !== null) {
      coverage = coverageFromStats(
        rangeStats,
        { start: replay.rangeStart, end: replay.rangeEnd },
        replay.timeframe,
        replay.datasetBars,
      )
    } else {
      const allBars = await getCandles({
        symbol: replay.symbol,
        timeframe: replay.timeframe,
        from: replay.rangeStart,
        to: replay.rangeEnd,
        limit: 20000,
      })
      coverage = assessCoverage(
        allBars,
        { start: replay.rangeStart, end: replay.rangeEnd },
        replay.timeframe,
      )
    }
  }

  const { summary } = await getSessionPerformance(session, trades)

  // Equity available to risk against: the session's balance as it stands.
  const balance = summary.accountBalance || session.initialBalance
  const riskPercent = session.riskPerTrade > 0 ? session.riskPerTrade : 1

  // Trades produced by THIS replay, for chart markers and the trade history.
  // Manual trades in the same session are excluded — they have no bars here.
  const replayTrades = trades.filter((t) => t.replayId === replay.id)

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={breadcrumbTrail("/replay", {
          label: `${replay.symbol} replay`,
        })}
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
          strategies={strategies}
          replayTrades={replayTrades}
          pendingOrder={pendingOrder}
          pricePrecision={pricePrecision}
          coverage={coverage}
        />
      )}

      {/* Realised performance + equity curve. Session-wide, so a manual trade
          in the same session is included in the statistics even though it has
          no marker on this chart. */}
      <ReplayPerformance trades={trades} startingBalance={session.initialBalance} />

      {/* Orders are kept separate from realised trade history: a pending or
          cancelled order is an intent, not a trade, and never reaches analytics. */}
      <ReplayOrders orders={orders} />

      <Card className="p-0">
        <TradeTable
          showLevels
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
