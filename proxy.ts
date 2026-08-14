import type { NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

/**
 * Next.js 16 proxy (formerly the `middleware` convention).
 *
 * Refreshes the Supabase auth cookie on every navigation and enforces route
 * protection before a protected page is rendered.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Run on every request except static assets and image files, so the auth
     * cookie is refreshed on normal navigations without wasting work on
     * bundles and icons.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
