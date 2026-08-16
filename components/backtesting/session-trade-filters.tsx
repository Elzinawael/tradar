"use client"

import { useCallback, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Strategy } from "@/lib/types"

const ANY = "all"
const KEYS = ["symbol", "direction", "status", "strategyId", "from", "to"]

/** Session trade filters, stored in the URL like the live trades page. */
export function SessionTradeFilters({ strategies }: { strategies: Strategy[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (!value || value === ANY) params.delete(key)
      else params.set(key, value)
      startTransition(() => router.push(`${pathname}?${params.toString()}`))
    },
    [pathname, router, searchParams],
  )

  const hasFilters = KEYS.some((k) => searchParams.get(k))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault()
          const input = e.currentTarget.elements.namedItem(
            "symbol",
          ) as HTMLInputElement | null
          setParam("symbol", input?.value.trim() ?? "")
        }}
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="symbol"
          defaultValue={searchParams.get("symbol") ?? ""}
          placeholder="Search symbol"
          aria-label="Filter by symbol"
          className="h-9 w-[160px] pl-8"
        />
      </form>

      <Select
        value={searchParams.get("status") ?? ANY}
        onValueChange={(v) => setParam("status", v)}
      >
        <SelectTrigger className="h-9 w-[130px]" aria-label="Filter by result">
          <SelectValue placeholder="Result" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All results</SelectItem>
          <SelectItem value="win">Win</SelectItem>
          <SelectItem value="loss">Loss</SelectItem>
          <SelectItem value="breakeven">Breakeven</SelectItem>
          <SelectItem value="open">Open</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={searchParams.get("direction") ?? ANY}
        onValueChange={(v) => setParam("direction", v)}
      >
        <SelectTrigger className="h-9 w-[120px]" aria-label="Filter by side">
          <SelectValue placeholder="Side" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Both sides</SelectItem>
          <SelectItem value="long">Long</SelectItem>
          <SelectItem value="short">Short</SelectItem>
        </SelectContent>
      </Select>

      {strategies.length > 0 && (
        <Select
          value={searchParams.get("strategyId") ?? ANY}
          onValueChange={(v) => setParam("strategyId", v)}
        >
          <SelectTrigger className="h-9 w-[160px]" aria-label="Filter by strategy">
            <SelectValue placeholder="Strategy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All strategies</SelectItem>
            {strategies.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Input
        type="date"
        aria-label="From date"
        defaultValue={searchParams.get("from") ?? ""}
        onChange={(e) => setParam("from", e.target.value)}
        className="h-9 w-[150px]"
      />
      <Input
        type="date"
        aria-label="To date"
        defaultValue={searchParams.get("to") ?? ""}
        onChange={(e) => setParam("to", e.target.value)}
        className="h-9 w-[150px]"
      />

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => startTransition(() => router.push(pathname))}
        >
          <X className="size-4" />
          Clear
        </Button>
      )}
    </div>
  )
}
