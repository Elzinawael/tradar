import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { SessionForm } from "@/components/backtesting/session-form"
import { getStrategies } from "@/lib/data"
import { breadcrumbTrail } from "@/lib/navigation"

export const metadata: Metadata = { title: "New backtest session" }

export default async function NewBacktestSessionPage() {
  const strategies = await getStrategies()

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={breadcrumbTrail("/backtesting/sessions", {
          label: "New session",
        })}
        title="New backtest session"
        description="Give the experiment a name, a starting balance and the rules you are testing."
      />
      <SessionForm strategies={strategies} />
    </div>
  )
}
