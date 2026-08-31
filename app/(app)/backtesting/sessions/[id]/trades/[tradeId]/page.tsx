import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { Trash2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { SimulatedTradeForm } from "@/components/backtesting/simulated-trade-form"
import { Button } from "@/components/ui/button"
import {
  getBacktestSessionById,
  getSimulatedTradeById,
  getStrategies,
} from "@/lib/data"
import { breadcrumbTrail } from "@/lib/navigation"
import { deleteSimulatedTrade } from "@/lib/actions/backtesting"

export const metadata: Metadata = { title: "Edit simulated trade" }

export default async function EditSimulatedTradePage({
  params,
}: {
  params: Promise<{ id: string; tradeId: string }>
}) {
  const { id, tradeId } = await params
  const [session, trade, strategies] = await Promise.all([
    getBacktestSessionById(id),
    getSimulatedTradeById(tradeId),
    getStrategies(),
  ])

  // Guard against a trade id from another session being addressed through
  // this URL, on top of the RLS scoping already applied by the query.
  if (!session || !trade || trade.sessionId !== session.id) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={breadcrumbTrail(
          "/backtesting/sessions",
          { label: session.name, href: `/backtesting/sessions/${session.id}` },
          { label: trade.symbol },
        )}
        title={`Edit ${trade.symbol}`}
        description={`Simulated trade in ${session.name}.`}
        actions={
          <form action={deleteSimulatedTrade}>
            <input type="hidden" name="id" value={trade.id} />
            <input type="hidden" name="sessionId" value={session.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-negative hover:bg-negative/10 hover:text-negative"
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </form>
        }
      />
      <SimulatedTradeForm
        sessionId={session.id}
        strategies={strategies}
        trade={trade}
      />
    </div>
  )
}
