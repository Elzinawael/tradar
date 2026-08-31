import * as React from "react"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface FieldProps {
  label: React.ReactNode
  /** Associates the label with the control; pass the same value as the control's `id`. */
  htmlFor?: string
  /** Helper text shown below the control. Hidden while an error is present. */
  hint?: React.ReactNode
  /** Field-level error from a server action. */
  error?: string | null
  className?: string
  children: React.ReactNode
}

/**
 * Label + control + hint + error, in the exact arrangement every form in the
 * app currently hand-writes (`flex flex-col gap-2`). Purely presentational —
 * validation still lives in the server action and is passed back via `error`.
 */
function Field({ label, htmlFor, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && <p className="text-xs text-negative">{error}</p>}
    </div>
  )
}

export { Field }
