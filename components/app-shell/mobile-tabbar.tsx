"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"
import { activeNavHref, primaryNavItems } from "@/lib/navigation"
import { cn } from "@/lib/utils"

interface MobileTabbarProps {
  /** Opens the full navigation drawer (the same Sheet the topbar opens). */
  onOpenNav: () => void
}

/**
 * Bottom navigation on mobile. Shows the `primary` destinations from
 * lib/navigation.ts plus a "Menu" button for the complete navigation, so no
 * route becomes unreachable on small screens.
 */
export function MobileTabbar({ onOpenNav }: MobileTabbarProps) {
  const pathname = usePathname()
  const active = activeNavHref(pathname)

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-background/95 backdrop-blur lg:hidden"
      aria-label="Primary"
    >
      {primaryNavItems.map((item) => {
        const isActive = item.href === active
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-2xs font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <item.icon className="size-5" />
            {item.label}
          </Link>
        )
      })}
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation menu"
        className="flex flex-1 flex-col items-center justify-center gap-1 text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Menu className="size-5" />
        Menu
      </button>
    </nav>
  )
}
