import Link from "next/link"
import type { Metadata } from "next"
import { Wallet } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { ImportWizard } from "@/components/import/import-wizard"
import { getAccounts } from "@/lib/data"

export const metadata: Metadata = { title: "Import trades" }

export default async function ImportPage() {
  const accounts = await getAccounts()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import trades"
        description="Upload a CSV from your broker. P&L, status and hold time are recalculated by TRADAR, not taken from the file."
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No trading account yet"
          description="Imported trades need an account to belong to."
          action={
            <Button asChild>
              <Link href="/settings">Add an account</Link>
            </Button>
          }
        />
      ) : (
        <ImportWizard accounts={accounts} />
      )}
    </div>
  )
}
