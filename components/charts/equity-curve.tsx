"use client"

import { useMemo } from "react"
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { DailyPnl } from "@/lib/types"
import { formatCurrency } from "@/lib/utils"

/**
 * Renders a cumulative equity curve from daily P&L records, seeded by the
 * account's starting balance. With no data (Stage 1) callers should render an
 * empty state instead of mounting this chart.
 */
export function EquityCurve({
  data,
  startingBalance = 0,
}: {
  data: DailyPnl[]
  startingBalance?: number
}) {
  const series = useMemo(() => {
    let running = startingBalance
    return data.map((d) => {
      running += d.pnl
      return { date: d.date, equity: running }
    })
  }, [data, startingBalance])

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
          minTickGap={32}
          tickFormatter={(v: string) =>
            new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          }
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={64}
          tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
        />
        <Tooltip
          cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }}
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            color: "var(--color-popover-foreground)",
            fontSize: 12,
          }}
          labelFormatter={(v: string) =>
            new Date(v).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          }
          formatter={(value: number) => [formatCurrency(value), "Equity"]}
        />
        <Area
          type="monotone"
          dataKey="equity"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          fill="url(#equityFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
