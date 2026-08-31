"use client"

import * as React from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, Check, Loader2 } from "lucide-react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The error / success banner pair every form renders after a server action
 * returns. Renders nothing when both are empty. Matches the markup the forms
 * currently inline so adoption is a drop-in.
 */
function FormFeedback({
  error,
  message,
  className,
}: {
  error?: string | null
  message?: string | null
  className?: string
}) {
  if (!error && !message) return null

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div className="flex items-start gap-2 rounded-md border border-positive/30 bg-positive/10 p-3 text-sm text-positive">
          <Check className="mt-0.5 size-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}
    </div>
  )
}

interface SubmitButtonProps extends Omit<ButtonProps, "type"> {
  /** Label shown while the enclosing form is submitting. Defaults to `children`. */
  pendingText?: React.ReactNode
}

/**
 * Submit button wired to the enclosing form's pending state via
 * `useFormStatus`: shows a spinner and disables itself during submission.
 * Replaces the local `SubmitButton` re-declared in ~9 forms.
 */
function SubmitButton({
  children,
  pendingText,
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled} {...props}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </Button>
  )
}

export { FormFeedback, SubmitButton }
