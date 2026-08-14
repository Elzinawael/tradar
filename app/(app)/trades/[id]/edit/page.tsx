import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { TradeForm } from "@/components/trades/trade-form"
import { getAccounts, getStrategies, getTradeById } from "@/lib/data"

export const metadata: Metadata = { title: "Edit trade" }

export default async function EditTradePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [trade, accounts, strategies] = await Promise.all([
    getTradeById(id),
    getAccounts(),
    getStrategies(),
  ])

  if (!trade) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${trade.symbol}`}
        description="Update the execution details. Derived values are recalculated on save."
      />
      <TradeForm accounts={accounts} strategies={strategies} trade={trade} />
    </div>
  )
}
