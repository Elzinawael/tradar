import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { SimulatedTradeForm } from "@/components/backtesting/simulated-trade-form"
import { getBacktestSessionById, getStrategies } from "@/lib/data"

export const metadata: Metadata = { title: "Add simulated trade" }

export default async function NewSimulatedTradePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [session, strategies] = await Promise.all([
    getBacktestSessionById(id),
    getStrategies(),
  ])

  if (!session) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add simulated trade"
        description={`Recording a hypothetical execution in ${session.name}.`}
      />
      <SimulatedTradeForm
        sessionId={session.id}
        defaultSymbol={session.symbol}
        strategies={strategies}
      />
    </div>
  )
}
