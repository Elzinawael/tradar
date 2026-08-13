"use client"

import { CalendarDays } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const RANGES = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "ytd", label: "Year to Date" },
  { value: "all", label: "All Time" },
]

interface DateRangePickerProps {
  defaultValue?: string
  className?: string
}

export function DateRangePicker({
  defaultValue = "month",
  className,
}: DateRangePickerProps) {
  return (
    <Select defaultValue={defaultValue}>
      <SelectTrigger className={className ?? "h-9 w-[160px] gap-2 border-border bg-card/60"}>
        <CalendarDays className="size-4 text-muted-foreground" />
        <SelectValue placeholder="Date range" />
      </SelectTrigger>
      <SelectContent>
        {RANGES.map((range) => (
          <SelectItem key={range.value} value={range.value}>
            {range.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
