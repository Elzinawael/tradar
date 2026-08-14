import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { TradeForm } from "@/components/trades/trade-form"
import { getAccounts, getStrategies } from "@/lib/data"
import { Wallet } from "lucide-react"

export const metadata: Metadata = { title: "Log a trade" }

export default async function NewTradePage() {
  const [accounts, strategies] = await Promise.all([
    getAccounts(),
    getStrategies(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Log a trade"
        description="Record an execution. P&L, status, duration and R-multiple are calculated for you."
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No trading account available"
          description="Trades belong to an account. Sign in to have your default account created, or add one in settings."
        />
      ) : (
        <TradeForm accounts={accounts} strategies={strategies} />
      )}
    </div>
  )
}
