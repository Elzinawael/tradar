"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BarChart3, BookOpen, LayoutDashboard, ListChecks, Target } from "lucide-react"
import { cn } from "@/lib/utils"

const items = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Trades", href: "/trades", icon: ListChecks },
  { label: "Journal", href: "/journal", icon: BookOpen },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Strategies", href: "/strategies", icon: Target },
]

export function MobileTabbar() {
  const pathname = usePathname()
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-background/95 backdrop-blur lg:hidden"
      aria-label="Primary mobile"
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <item.icon className="size-5" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
