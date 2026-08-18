import Link from "next/link"
import { ArrowDown, ArrowUp, ListChecks } from "lucide-react"
import type { Trade, TradeRow } from "@/lib/types"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn, formatCurrency } from "@/lib/utils"
import { formatDuration } from "@/lib/trade-math"

interface TradeTableProps {
  trades: TradeRow[]
  /** Current sort column and direction, for header affordances. */
  sort: string
  order: "asc" | "desc"
  /** Preserves active filters when a sort header is clicked. */
  buildSortHref: (column: string) => string
  /**
   * Where a row's symbol links to. Defaults to the live trade detail page;
   * backtesting passes its own so simulated trades open inside their session.
   */
  hrefFor?: (trade: TradeRow) => string
  /** Message shown when there are no rows. */
  emptyTitle?: string
  emptyDescription?: string
  /**
   * Adds Setup and Market session columns. Off by default so the live trades
   * table, which has no classification, is unchanged.
   */
  showClassification?: boolean
  /**
   * Adds Entry, Exit, Stop and Target columns for simulated/replay trades.
   * Off by default, so the live trades table keeps its existing shape.
   */
  showLevels?: boolean
}

const STATUS_TONE: Record<Trade["status"], string> = {
  win: "border-positive/30 bg-positive/10 text-positive",
  loss: "border-negative/30 bg-negative/10 text-negative",
  breakeven: "border-border bg-muted/40 text-muted-foreground",
  open: "border-primary/30 bg-primary/10 text-primary",
}

function SortHeader({
  label,
  column,
  sort,
  order,
  buildSortHref,
  className,
}: {
  label: string
  column: string
  sort: string
  order: "asc" | "desc"
  buildSortHref: (column: string) => string
  className?: string
}) {
  const active = sort === column
  return (
    <TableHead className={className}>
      <Link
        href={buildSortHref(column)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
        aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        {active &&
          (order === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          ))}
      </Link>
    </TableHead>
  )
}

export function TradeTable({
  trades,
  sort,
  order,
  buildSortHref,
  hrefFor = (trade) => `/trades/${trade.id}`,
  emptyTitle = "No trades found",
  emptyDescription = "Log your first trade, or adjust the filters to widen your search.",
  showClassification = false,
  showLevels = false,
}: TradeTableProps) {
  if (trades.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHeader
              label="Symbol"
              column="symbol"
              sort={sort}
              order={order}
              buildSortHref={buildSortHref}
            />
            <TableHead>Side</TableHead>
            {showLevels && (
              <>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Exit</TableHead>
                <TableHead className="hidden text-right md:table-cell">SL</TableHead>
                <TableHead className="hidden text-right md:table-cell">TP</TableHead>
              </>
            )}
            <SortHeader
              label="Opened"
              column="opened_at"
              sort={sort}
              order={order}
              buildSortHref={buildSortHref}
            />
            <TableHead className="hidden md:table-cell">Strategy</TableHead>
            {showClassification && (
              <>
                <TableHead className="hidden lg:table-cell">Setup</TableHead>
                <TableHead className="hidden xl:table-cell">Session</TableHead>
              </>
            )}
            <SortHeader
              label="Qty"
              column="quantity"
              sort={sort}
              order={order}
              buildSortHref={buildSortHref}
              className="hidden text-right sm:table-cell"
            />
            <TableHead className="hidden lg:table-cell">Held</TableHead>
            <SortHeader
              label="R"
              column="r_multiple"
              sort={sort}
              order={order}
              buildSortHref={buildSortHref}
              className="hidden text-right lg:table-cell"
            />
            <SortHeader
              label="Status"
              column="status"
              sort={sort}
              order={order}
              buildSortHref={buildSortHref}
            />
            <SortHeader
              label="P&L"
              column="pnl"
              sort={sort}
              order={order}
              buildSortHref={buildSortHref}
              className="text-right"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => (
            <TableRow key={trade.id} className="hover:bg-muted/30">
              <TableCell className="font-medium">
                <Link
                  href={hrefFor(trade)}
                  className="underline-offset-2 hover:text-primary hover:underline"
                >
                  {trade.symbol}
                </Link>
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    "text-xs font-medium uppercase tracking-wide",
                    trade.direction === "long"
                      ? "text-positive"
                      : "text-negative",
                  )}
                >
                  {trade.direction}
                </span>
              </TableCell>
              {showLevels && (
                <>
                  <TableCell className="text-right font-mono tabular-nums">
                    {trade.entryPrice}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {/* An open trade has no exit yet, and none is invented. */}
                    {trade.exitPrice ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono tabular-nums md:table-cell">
                    {"stopPrice" in trade && trade.stopPrice !== null ? (
                      String(trade.stopPrice)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono tabular-nums md:table-cell">
                    {"takeProfit" in trade && trade.takeProfit !== null ? (
                      String(trade.takeProfit)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </>
              )}
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {new Date(trade.openedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </TableCell>
              <TableCell className="hidden max-w-[180px] truncate text-muted-foreground md:table-cell">
                {trade.strategyName ?? "—"}
              </TableCell>
              {showClassification && (
                <>
                  <TableCell className="hidden lg:table-cell">
                    {"setup" in trade && trade.setup ? (
                      <Badge variant="outline" className="font-normal">
                        {String(trade.setup)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden max-w-[160px] truncate text-muted-foreground xl:table-cell">
                    {"marketSession" in trade && trade.marketSession
                      ? String(trade.marketSession)
                      : "—"}
                  </TableCell>
                </>
              )}
              <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">
                {trade.quantity}
              </TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">
                {formatDuration(trade.durationMinutes)}
              </TableCell>
              <TableCell className="hidden text-right font-mono tabular-nums lg:table-cell">
                {/* Realised R only. An open trade shows a dash rather than an
                    unrealized figure, so the column never mixes the two. */}
                {trade.status === "open" || trade.rMultiple === null
                  ? "—"
                  : `${trade.rMultiple.toFixed(2)}R`}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={cn("capitalize", STATUS_TONE[trade.status])}
                >
                  {trade.status}
                </Badge>
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono font-medium tabular-nums",
                  trade.status === "open"
                    ? "text-muted-foreground"
                    : trade.pnl > 0
                      ? "text-positive"
                      : trade.pnl < 0
                        ? "text-negative"
                        : "text-muted-foreground",
                )}
              >
                {trade.status === "open"
                  ? "—"
                  : formatCurrency(trade.pnl, { signed: true })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
