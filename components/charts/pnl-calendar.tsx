"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { DailyPnl } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { cn, formatCurrency } from "@/lib/utils"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function PnlCalendar({ data }: { data: DailyPnl[] }) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const byDate = useMemo(() => {
    const map = new Map<string, DailyPnl>()
    for (const d of data) map.set(d.date, d)
    return map
  }, [data])

  const { cells, monthLabel } = useMemo(() => {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const result: ({ day: number; key: string } | null)[] = []
    for (let i = 0; i < firstDay; i++) result.push(null)
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      result.push({ day, key })
    }
    return {
      cells: result,
      monthLabel: cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    }
  }, [cursor])

  function shiftMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-medium">{monthLabel}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} className="aspect-square" />
          const record = byDate.get(cell.key)
          const tone =
            !record
              ? "bg-muted/30 text-muted-foreground"
              : record.pnl > 0
                ? "bg-positive/15 text-positive ring-1 ring-inset ring-positive/25"
                : record.pnl < 0
                  ? "bg-negative/15 text-negative ring-1 ring-inset ring-negative/25"
                  : "bg-muted text-muted-foreground"
          return (
            <div
              key={cell.key}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-md p-1 text-center transition-colors",
                tone,
              )}
            >
              <span className="text-[11px] font-medium leading-none opacity-80">
                {cell.day}
              </span>
              {record && (
                <span className="mt-1 text-[10px] font-semibold leading-none">
                  {formatCurrency(record.pnl, { compact: true, signed: true })}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
