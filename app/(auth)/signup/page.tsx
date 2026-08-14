import type { Metadata } from "next"
import { AuthForm } from "@/components/auth/auth-form"
import { isSupabaseConfigured } from "@/lib/supabase/config"

export const metadata: Metadata = {
  title: "Sign up",
}

export default function SignupPage() {
  return <AuthForm mode="signup" configured={isSupabaseConfigured()} />
}
