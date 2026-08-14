"use client"

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

export function AccountSelector({ accounts }: AccountSelectorProps) {
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
    <Select defaultValue={accounts[0]?.id}>
      <SelectTrigger className="h-9 w-[180px] gap-2 border-border bg-card/60">
        <Wallet className="size-4 text-muted-foreground" />
        <SelectValue placeholder="Select account" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {account.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
