import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { DesignReference } from "./design-reference"

export const metadata: Metadata = {
  title: "Design reference",
  robots: { index: false, follow: false },
}

/**
 * Development-only design-system reference.
 *
 * Returns 404 in production, so the route never ships. It exists purely so the
 * token scales and shared primitives have one place to be viewed and checked
 * during the UI/UX phases.
 */
export default function DesignReferencePage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <DesignReference />
}
