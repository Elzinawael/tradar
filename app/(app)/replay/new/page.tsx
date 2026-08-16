import Link from "next/link"
import type { Metadata } from "next"
import { FlaskConical } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { NewReplayForm } from "@/components/replay/new-replay-form"
import { getBacktestSessionList, getCandleCatalog } from "@/lib/data"

export const metadata: Metadata = { title: "New replay" }

export default async function NewReplayPage() {
  const [sessions, catalog] = await Promise.all([
    getBacktestSessionList(),
    getCandleCatalog(),
  ])

  if (sessions.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="New replay"
          description="A replay records its trades into a backtest session."
        />
        <EmptyState
          icon={FlaskConical}
          title="No backtest session yet"
          description="Replay trades belong to a session so they roll into its equity curve and statistics."
          action={
            <Button asChild>
              <Link href="/backtesting/sessions/new">Create a session</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New replay"
        description="Pick a market, a window of history, and the session to record into."
      />
      <NewReplayForm sessions={sessions} catalog={catalog} />
    </div>
  )
}
