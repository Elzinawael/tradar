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
import type { Strategy, TradingAccount } from "@/lib/types"

interface TradeFiltersProps {
  accounts: TradingAccount[]
  strategies: Strategy[]
}

const ANY = "all"

/**
 * Filters are stored in the URL rather than component state so that a filtered
 * view is shareable and bookmarkable, and so the list itself stays a Server
 * Component that queries Postgres directly.
 */
export function TradeFilters({ accounts, strategies }: TradeFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (!value || value === ANY) params.delete(key)
      else params.set(key, value)
      // Any filter change invalidates the current page offset.
      params.delete("page")
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`)
      })
    },
    [pathname, router, searchParams],
  )

  const hasFilters = ["symbol", "status", "direction", "accountId", "strategyId", "from", "to"].some(
    (k) => searchParams.get(k),
  )

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
          aria-label="Search by symbol"
          className="h-9 w-[170px] pl-8"
        />
      </form>

      <Select
        value={searchParams.get("status") ?? ANY}
        onValueChange={(v) => setParam("status", v)}
      >
        <SelectTrigger className="h-9 w-[130px]" aria-label="Filter by status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All statuses</SelectItem>
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

      {accounts.length > 1 && (
        <Select
          value={searchParams.get("accountId") ?? ANY}
          onValueChange={(v) => setParam("accountId", v)}
        >
          <SelectTrigger className="h-9 w-[160px]" aria-label="Filter by account">
            <SelectValue placeholder="Account" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All accounts</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

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

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => startTransition(() => router.push(pathname))}
        >
          <X className="size-4" />
          Clear
        </Button>
      )}
    </div>
  )
}
