import type { Metadata } from "next"
import { Check, Gauge, Plus, Trash2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getProgressRules } from "@/lib/data"
import {
  addProgressRule,
  deleteProgressRule,
  toggleProgressRule,
} from "@/lib/actions/progress"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Progress" }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function todayKey(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date } = await searchParams
  const activeDate = date && ISO_DATE.test(date) ? date : todayKey()

  const rules = await getProgressRules(activeDate)
  const completed = rules.filter((r) => r.completed).length
  const rate = rules.length > 0 ? Math.round((completed / rules.length) * 100) : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Progress"
        description="Discipline is a process you can measure. Tick each rule you honoured today."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Rules tracked" value={String(rules.length)} />
        <MetricCard
          label="Completed today"
          value={`${completed}/${rules.length}`}
          tone={completed === rules.length && rules.length > 0 ? "positive" : "default"}
        />
        <MetricCard
          label="Adherence"
          value={`${rate}%`}
          tone={rate >= 80 ? "positive" : rate < 50 ? "negative" : "default"}
        />
        <MetricCard
          label="Date"
          value={new Date(`${activeDate}T00:00:00`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Today&apos;s checklist
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rules.length === 0 ? (
              <EmptyState
                icon={Gauge}
                title="No rules yet"
                description="Add the trading rules you want to hold yourself to."
                compact
              />
            ) : (
              <ul className="flex flex-col gap-1">
                {rules.map((rule) => (
                  <li
                    key={rule.id}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/30"
                  >
                    <form action={toggleProgressRule} className="flex-1">
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <input type="hidden" name="date" value={activeDate} />
                      <input
                        type="hidden"
                        name="completed"
                        value={String(!rule.completed)}
                      />
                      <button
                        type="submit"
                        className="flex w-full items-center gap-3 text-left"
                        aria-pressed={rule.completed}
                      >
                        <span
                          className={cn(
                            "grid size-5 shrink-0 place-items-center rounded border transition-colors",
                            rule.completed
                              ? "border-positive bg-positive/20 text-positive"
                              : "border-border text-transparent",
                          )}
                        >
                          <Check className="size-3.5" />
                        </span>
                        <span
                          className={cn(
                            "text-sm",
                            rule.completed
                              ? "text-muted-foreground line-through"
                              : "text-foreground",
                          )}
                        >
                          {rule.label}
                        </span>
                      </button>
                    </form>
                    <form action={deleteProgressRule}>
                      <input type="hidden" name="id" value={rule.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-negative"
                        aria-label={`Delete rule: ${rule.label}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Add a rule</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={addProgressRule} className="flex flex-col gap-3">
              <Input
                name="label"
                placeholder="Wait for confirmation candle"
                aria-label="New rule"
                required
              />
              <Button type="submit" variant="outline">
                <Plus className="size-4" />
                Add rule
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
