"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { saveJournalEntry } from "@/lib/actions/journal"
import {
  initialJournalState,
  type JournalActionState,
} from "@/lib/actions/state"
import type { JournalEntry } from "@/lib/types"

const MOODS = ["Calm", "Focused", "Confident", "Anxious", "Frustrated", "Tired"]

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      Save entry
    </Button>
  )
}

export function JournalForm({
  date,
  entry,
}: {
  date: string
  entry: JournalEntry | null
}) {
  const [state, formAction] = useActionState<JournalActionState, FormData>(
    saveJournalEntry,
    initialJournalState,
  )

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="flex flex-col gap-6">
          {state.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="entryDate">Date</Label>
              <Input
                id="entryDate"
                name="entryDate"
                type="date"
                defaultValue={date}
                required
              />
              {state.fieldErrors.entryDate && (
                <p className="text-xs text-negative">
                  {state.fieldErrors.entryDate}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mood">Mood</Label>
              <Select name="mood" defaultValue={entry?.mood ?? "none"}>
                <SelectTrigger id="mood">
                  <SelectValue placeholder="Not recorded" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not recorded</SelectItem>
                  {MOODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="preMarketPlan">Pre-market plan</Label>
            <Textarea
              id="preMarketPlan"
              name="preMarketPlan"
              rows={3}
              defaultValue={entry?.preMarketPlan}
              placeholder="Levels, bias, setups you are watching."
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="sessionNotes">Session notes</Label>
            <Textarea
              id="sessionNotes"
              name="sessionNotes"
              rows={3}
              defaultValue={entry?.sessionNotes}
              placeholder="What happened while you were trading."
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="postMarketReview">Post-market review</Label>
            <Textarea
              id="postMarketReview"
              name="postMarketReview"
              rows={3}
              defaultValue={entry?.postMarketReview}
              placeholder="Did you follow your plan? What would you repeat?"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="lessons">Lessons</Label>
            <Textarea
              id="lessons"
              name="lessons"
              rows={2}
              defaultValue={entry?.lessons}
              placeholder="One concrete thing to carry into tomorrow."
            />
          </div>

          <div>
            <SubmitButton />
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
