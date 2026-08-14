"use client"

import { useCallback, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CalendarDays } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RANGE_KEYS, RANGE_LABELS } from "@/lib/date-range"

interface DateRangePickerProps {
  defaultValue?: string
  className?: string
}

/**
 * Writes the selected range into the URL so the surrounding Server Components
 * re-query with the new bounds. The range is shareable and survives reload.
 */
export function DateRangePicker({
  defaultValue = "all",
  className,
}: DateRangePickerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const current = searchParams.get("range") ?? defaultValue

  const onChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === "all") params.delete("range")
      else params.set("range", value)
      params.delete("page")
      startTransition(() => router.push(`${pathname}?${params.toString()}`))
    },
    [pathname, router, searchParams],
  )

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger
        className={className ?? "h-9 w-[160px] gap-2 border-border bg-card/60"}
        aria-label="Date range"
      >
        <CalendarDays className="size-4 text-muted-foreground" />
        <SelectValue placeholder="Date range" />
      </SelectTrigger>
      <SelectContent>
        {RANGE_KEYS.map((key) => (
          <SelectItem key={key} value={key}>
            {RANGE_LABELS[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
