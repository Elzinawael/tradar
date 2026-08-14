import Link from "next/link"
import type { Metadata } from "next"
import { BookOpen } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { JournalForm } from "@/components/journal/journal-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/empty-state"
import { getJournalEntries, getJournalEntryByDate } from "@/lib/data"

export const metadata: Metadata = { title: "Journal" }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Today's date as a local YYYY-MM-DD key. */
function todayKey(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date } = await searchParams
  const activeDate = date && ISO_DATE.test(date) ? date : todayKey()

  const [entry, entries] = await Promise.all([
    getJournalEntryByDate(activeDate),
    getJournalEntries(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal"
        description="Plan the session, record what happened, review honestly."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <JournalForm date={activeDate} entry={entry} />

        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Past entries</CardTitle>
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No entries yet"
                description="Your saved entries will be listed here."
                compact
              />
            ) : (
              <ul className="flex flex-col">
                {entries.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/journal?date=${item.date}`}
                      className={
                        item.date === activeDate
                          ? "flex items-center justify-between gap-2 rounded-md bg-sidebar-accent px-2 py-2 text-sm text-foreground"
                          : "flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
                      }
                    >
                      <span>
                        {new Date(`${item.date}T00:00:00`).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric", year: "numeric" },
                        )}
                      </span>
                      {item.mood && (
                        <span className="text-xs text-muted-foreground">
                          {item.mood}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
