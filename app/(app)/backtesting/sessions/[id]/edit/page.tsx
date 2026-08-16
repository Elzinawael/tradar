import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { SessionForm } from "@/components/backtesting/session-form"
import { getBacktestSessionById, getStrategies } from "@/lib/data"

export const metadata: Metadata = { title: "Edit session" }

export default async function EditBacktestSessionPage({
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
        title={`Edit ${session.name}`}
        description="Changing the starting balance re-bases the equity curve."
      />
      <SessionForm session={session} strategies={strategies} />
    </div>
  )
}
