import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { StrategyForm } from "@/components/strategies/strategy-form"

export const metadata: Metadata = { title: "New strategy" }

export default function NewStrategyPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="New strategy"
        description="Write the rules down so you can hold yourself to them."
      />
      <StrategyForm />
    </div>
  )
}
