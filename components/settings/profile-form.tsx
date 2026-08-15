"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { updateProfile } from "@/lib/actions/profile"
import {
  initialSettingsState,
  type SettingsActionState,
} from "@/lib/actions/state"
import type { Profile } from "@/lib/types"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      Save profile
    </Button>
  )
}

export function ProfileForm({
  profile,
  email,
}: {
  profile: Profile | null
  email: string
}) {
  const [state, formAction] = useActionState<SettingsActionState, FormData>(
    updateProfile,
    initialSettingsState,
  )

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{state.error}</span>
        </div>
      )}

      {state.message && (
        <div className="flex items-start gap-2 rounded-md border border-positive/30 bg-positive/10 p-3 text-xs text-positive">
          <Check className="mt-0.5 size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            name="fullName"
            defaultValue={profile?.fullName ?? ""}
            placeholder="Alex Trader"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} disabled readOnly />
          <p className="text-xs text-muted-foreground">
            Managed by your login provider.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="timezone">Timezone</Label>
          <Input
            id="timezone"
            name="timezone"
            defaultValue={profile?.timezone ?? "UTC"}
            placeholder="Africa/Tunis"
          />
          <p className="text-xs text-muted-foreground">
            IANA name, e.g. Africa/Tunis. Used for trading-day boundaries.
          </p>
          {state.fieldErrors.timezone && (
            <p className="text-xs text-negative">
              {state.fieldErrors.timezone}
            </p>
          )}
        </div>
      </div>

      <div>
        <SubmitButton />
      </div>
    </form>
  )
}
