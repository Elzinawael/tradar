"use client"

import { Wallet } from "lucide-react"
import { accounts } from "@/lib/data"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function AccountSelector() {
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
