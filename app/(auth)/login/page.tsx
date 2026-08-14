import type { Metadata } from "next"
import { AuthForm } from "@/components/auth/auth-form"
import { isSupabaseConfigured } from "@/lib/supabase/config"

export const metadata: Metadata = {
  title: "Log in",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>
}) {
  const { redirectTo } = await searchParams

  // Only allow internal paths — guards against open-redirect via the query.
  const safe =
    redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
      ? redirectTo
      : "/dashboard"

  return (
    <AuthForm
      mode="login"
      configured={isSupabaseConfigured()}
      redirectTo={safe}
    />
  )
}
