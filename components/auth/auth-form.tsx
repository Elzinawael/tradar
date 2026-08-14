"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import Link from "next/link"
import { AlertCircle, Info, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { signIn, signUp } from "@/lib/actions/auth"
import { initialAuthState, type AuthActionState } from "@/lib/actions/state"

interface AuthFormProps {
  mode: "login" | "signup"
  /** False when Supabase env vars are absent; shows a setup notice. */
  configured?: boolean
  /** Where to send the user after a successful login. */
  redirectTo?: string
}

function SubmitButton({ isSignup }: { isSignup: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="mt-1 w-full" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {isSignup ? "Create account" : "Log in"}
    </Button>
  )
}

export function AuthForm({
  mode,
  configured = true,
  redirectTo = "/dashboard",
}: AuthFormProps) {
  const isSignup = mode === "signup"

  const action = isSignup ? signUp : signIn
  const [state, formAction] = useActionState<AuthActionState, FormData>(
    action,
    initialAuthState,
  )

  return (
    <Card className="w-full">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          {isSignup ? "Create your account" : "Welcome back"}
        </CardTitle>
        <CardDescription>
          {isSignup
            ? "Start journaling and analyzing your trades."
            : "Log in to continue to your trading journal."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="redirectTo" value={redirectTo} />

          {isSignup && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                placeholder="Alex Trader"
                required
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              {!isSignup && (
                <span className="text-xs text-muted-foreground">Forgot?</span>
              )}
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder="••••••••"
              minLength={8}
              required
            />
            {isSignup && (
              <p className="text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            )}
          </div>

          <SubmitButton isSignup={isSignup} />

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
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{state.message}</span>
            </div>
          )}

          {!configured && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                Supabase is not configured yet, so accounts cannot be created.
                You can still{" "}
                <Link
                  href="/dashboard"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  explore the platform
                </Link>
                .
              </span>
            </div>
          )}
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {isSignup ? "Already have an account? " : "Don't have an account? "}
          <Link
            href={isSignup ? "/login" : "/signup"}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {isSignup ? "Log in" : "Sign up"}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
