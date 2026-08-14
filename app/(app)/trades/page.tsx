import { Suspense } from "react"
import Link from "next/link"
import type { Metadata } from "next"
import { Plus } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { TradeTable } from "@/components/trades/trade-table"
import { TradeFilters } from "@/components/trades/trade-filters"
import { getAccounts, getStrategies, getTradesPage } from "@/lib/data"
import { formatCurrency } from "@/lib/utils"

export const metadata: Metadata = { title: "Trades" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function TradesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams

  const sort = first(params.sort) ?? "opened_at"
  const order = first(params.order) === "asc" ? "asc" : "desc"
  const page = Number(first(params.page) ?? 1)

  const [{ trades, total, pageCount }, accounts, strategies] = await Promise.all([
    getTradesPage({
      symbol: first(params.symbol),
      status: first(params.status),
      direction: first(params.direction),
      accountId: first(params.accountId),
      strategyId: first(params.strategyId),
      sort,
      direction_: order,
      page: Number.isFinite(page) ? page : 1,
    }),
    getAccounts(),
    getStrategies(),
  ])

  /** Preserves current filters when toggling a sort column. */
  function buildSortHref(column: string) {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      const v = first(value)
      if (v && key !== "sort" && key !== "order" && key !== "page") next.set(key, v)
    }
    next.set("sort", column)
    next.set("order", sort === column && order === "desc" ? "asc" : "desc")
    return `/trades?${next.toString()}`
  }

  function buildPageHref(target: number) {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      const v = first(value)
      if (v && key !== "page") next.set(key, v)
    }
    next.set("page", String(target))
    return `/trades?${next.toString()}`
  }

  const realised = trades
    .filter((t) => t.status !== "open")
    .reduce((sum, t) => sum + t.pnl, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trades"
        description={
          total > 0
            ? `${total} trade${total === 1 ? "" : "s"} · ${formatCurrency(realised, { signed: true })} on this page`
            : "Every position you have logged."
        }
        actions={
          <Button asChild>
            <Link href="/trades/new">
              <Plus className="size-4" />
              Add trade
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<div className="h-9" />}>
        <TradeFilters accounts={accounts} strategies={strategies} />
      </Suspense>

      <Card className="p-0">
        <TradeTable
          trades={trades}
          sort={sort}
          order={order}
          buildSortHref={buildSortHref}
        />
      </Card>

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </p>
          <div className="flex items-center gap-2">
            <Button
              asChild={page > 1}
              variant="outline"
              size="sm"
              disabled={page <= 1}
            >
              {page > 1 ? (
                <Link href={buildPageHref(page - 1)}>Previous</Link>
              ) : (
                <span>Previous</span>
              )}
            </Button>
            <Button
              asChild={page < pageCount}
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
            >
              {page < pageCount ? (
                <Link href={buildPageHref(page + 1)}>Next</Link>
              ) : (
                <span>Next</span>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
