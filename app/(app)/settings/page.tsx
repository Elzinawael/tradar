import Link from "next/link"
import type { Metadata } from "next"
import { Download, Star, Trash2, Wallet } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { AccountForm } from "@/components/settings/account-form"
import { ProfileForm } from "@/components/settings/profile-form"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getAccounts, getProfile, getTrades } from "@/lib/data"
import { getCurrentUser } from "@/lib/supabase/server"
import { deleteAccount, setDefaultAccount } from "@/lib/actions/accounts"
import { cn, formatCurrency } from "@/lib/utils"

export const metadata: Metadata = { title: "Settings" }

const TABS = [
  { key: "accounts", label: "Accounts" },
  { key: "profile", label: "Profile" },
  { key: "data", label: "Data" },
] as const

type TabKey = (typeof TABS)[number]["key"]

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const active: TabKey = TABS.some((t) => t.key === tab)
    ? (tab as TabKey)
    : "accounts"

  const [accounts, profile, user, trades] = await Promise.all([
    getAccounts(),
    getProfile(),
    getCurrentUser(),
    getTrades(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your trading accounts, profile and data."
      />

      {/* Tabs are links so /settings?tab=profile from the sidebar works
          directly and each tab is individually shareable. */}
      <nav className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/settings?tab=${t.key}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            aria-current={active === t.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {active === "accounts" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Add a trading account
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AccountForm />
            </CardContent>
          </Card>

          {accounts.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No trading accounts"
              description="Add an account above to start logging trades against it."
            />
          ) : (
            accounts.map((account) => (
              <Card key={account.id}>
                <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-semibold">
                      {account.name}
                    </CardTitle>
                    {account.isDefault && (
                      <Badge
                        variant="outline"
                        className="border-primary/30 bg-primary/10 text-primary"
                      >
                        Default
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!account.isDefault && (
                      <form action={setDefaultAccount}>
                        <input type="hidden" name="id" value={account.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          <Star className="size-4" />
                          Make default
                        </Button>
                      </form>
                    )}
                    {accounts.length > 1 && (
                      <form action={deleteAccount}>
                        <input type="hidden" name="id" value={account.id} />
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
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Opening balance{" "}
                    {formatCurrency(account.startingBalance)} · seeds the equity
                    curve.
                    {accounts.length > 1 &&
                      " Deleting an account also deletes its trades."}
                  </p>
                  <AccountForm account={account} />
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {active === "profile" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm profile={profile} email={user?.email ?? ""} />
          </CardContent>
        </Card>
      )}

      {active === "data" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Export data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Download every trade you have logged as a CSV file. Your data is
              yours — the export contains the full history for all accounts.
            </p>
            <div className="flex items-center gap-3">
              <Button asChild variant="outline">
                {/* A plain link, not fetch(): the browser handles the
                    Content-Disposition download natively. */}
                <a href="/api/export/trades" download>
                  <Download className="size-4" />
                  Export trades as CSV
                </a>
              </Button>
              <span className="text-xs text-muted-foreground">
                {trades.length} trade{trades.length === 1 ? "" : "s"}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
