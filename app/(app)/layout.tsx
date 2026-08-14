import { AppShell } from "@/components/app-shell/app-shell"
import { getAccounts } from "@/lib/data"
import { getCurrentUser } from "@/lib/supabase/server"

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [accounts, user] = await Promise.all([getAccounts(), getCurrentUser()])

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email ??
    "Trader"

  return (
    <AppShell accounts={accounts} displayName={displayName}>
      {children}
    </AppShell>
  )
}
