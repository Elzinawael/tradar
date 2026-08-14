"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import Link from "next/link"
import { AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import { saveStrategy } from "@/lib/actions/strategies"
import {
  initialStrategyState,
  type StrategyActionState,
} from "@/lib/actions/state"
import type { Strategy } from "@/lib/types"

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {isEdit ? "Save changes" : "Create strategy"}
    </Button>
  )
}

export function StrategyForm({ strategy }: { strategy?: Strategy }) {
  const isEdit = Boolean(strategy)
  const [state, formAction] = useActionState<StrategyActionState, FormData>(
    saveStrategy,
    initialStrategyState,
  )

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="flex flex-col gap-6">
          {isEdit && <input type="hidden" name="id" value={strategy?.id} />}

          {state.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={strategy?.name}
                placeholder="London breakout"
                required
              />
              {state.fieldErrors.name && (
                <p className="text-xs text-negative">{state.fieldErrors.name}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="market">Market</Label>
              <Input
                id="market"
                name="market"
                defaultValue={strategy?.market}
                placeholder="FX majors"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="timeframe">Timeframe</Label>
              <Input
                id="timeframe"
                name="timeframe"
                defaultValue={strategy?.timeframe}
                placeholder="M15"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              defaultValue={strategy?.description}
              placeholder="The idea in one or two sentences."
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="entryRules">Entry rules</Label>
              <Textarea
                id="entryRules"
                name="entryRules"
                rows={4}
                defaultValue={strategy?.entryRules}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="exitRules">Exit rules</Label>
              <Textarea
                id="exitRules"
                name="exitRules"
                rows={4}
                defaultValue={strategy?.exitRules}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="riskRules">Risk rules</Label>
              <Textarea
                id="riskRules"
                name="riskRules"
                rows={4}
                defaultValue={strategy?.riskRules}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="checklist">Pre-trade checklist</Label>
            <Textarea
              id="checklist"
              name="checklist"
              rows={4}
              defaultValue={strategy?.checklist.join("\n")}
              placeholder={"One item per line\nHigher timeframe aligned\nNews checked"}
            />
            <p className="text-xs text-muted-foreground">One item per line.</p>
          </div>

          <div className="flex items-center gap-2">
            <SubmitButton isEdit={isEdit} />
            <Button asChild variant="ghost">
              <Link href="/strategies">Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
