import Link from "next/link"
import { BrandLogo } from "@/components/brand-logo"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent)]"
      />
      <div className="relative flex w-full max-w-sm flex-col items-center">
        <Link href="/" aria-label="TRADAR home" className="mb-8">
          <BrandLogo size={40} />
        </Link>
        {children}
      </div>
    </div>
  )
}
