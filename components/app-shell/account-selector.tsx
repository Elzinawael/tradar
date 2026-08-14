"use client"

import { useCallback, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Wallet } from "lucide-react"
import type { TradingAccount } from "@/lib/types"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface AccountSelectorProps {
  accounts: TradingAccount[]
}

const ALL = "all"

/**
 * Scopes analytics to a single trading account by writing `accountId` into the
 * URL, so every Server Component on the page re-queries consistently.
 */
export function AccountSelector({ accounts }: AccountSelectorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const current = searchParams.get("accountId") ?? ALL

  const onChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === ALL) params.delete("accountId")
      else params.set("accountId", value)
      params.delete("page")
      startTransition(() => router.push(`${pathname}?${params.toString()}`))
    },
    [pathname, router, searchParams],
  )

  if (accounts.length === 0) {
    return (
      <Select disabled>
        <SelectTrigger className="h-9 w-[180px] gap-2 border-border bg-card/60">
          <Wallet className="size-4 text-muted-foreground" />
          <SelectValue placeholder="No accounts" />
        </SelectTrigger>
        <SelectContent />
      </Select>
    )
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger
        className="h-9 w-[180px] gap-2 border-border bg-card/60"
        aria-label="Trading account"
      >
        <Wallet className="size-4 text-muted-foreground" />
        <SelectValue placeholder="Select account" />
      </SelectTrigger>
      <SelectContent>
        {accounts.length > 1 && <SelectItem value={ALL}>All accounts</SelectItem>}
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {account.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
