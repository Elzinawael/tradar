"use client"

import { useState } from "react"
import Link from "next/link"
import { Info } from "lucide-react"
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

interface AuthFormProps {
  mode: "login" | "signup"
}

export function AuthForm({ mode }: AuthFormProps) {
  const isSignup = mode === "signup"
  const [submitted, setSubmitted] = useState(false)

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
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            // Stage 1: authentication is not yet connected to Supabase.
            setSubmitted(true)
          }}
        >
          {isSignup && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" name="name" autoComplete="name" placeholder="Alex Trader" required />
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
              required
            />
          </div>

          <Button type="submit" className="mt-1 w-full">
            {isSignup ? "Create account" : "Log in"}
          </Button>

          {submitted && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                Authentication connects to Supabase in Stage 2. For now you can{" "}
                <Link href="/dashboard" className="text-primary underline-offset-2 hover:underline">
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
