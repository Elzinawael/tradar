"use client"

import { Suspense } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { TradingAccount } from "@/lib/types"
import { signOut } from "@/lib/actions/auth"
import { AccountSelector } from "./account-selector"
import { DateRangePicker } from "@/components/date-range-picker"

interface TopbarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onOpenMobileNav: () => void
  accounts: TradingAccount[]
  displayName: string
}

/**
 * Pages whose data is scoped by the account + date-range controls. Elsewhere
 * the controls are hidden rather than shown as inert affordances (Trades has
 * its own account filter; Day View and Journal navigate by date themselves).
 */
const SCOPED_PATHS = ["/dashboard", "/reports"]

/** Two-letter initials from a display name or email, with a stable fallback. */
function initials(name: string): string {
  const cleaned = name.trim()
  if (!cleaned) return "TR"
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 1) {
    const token = words[0].replace(/[^a-zA-Z0-9]/g, "")
    return (token.slice(0, 2) || "TR").toUpperCase()
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export function Topbar({
  collapsed,
  onToggleCollapse,
  onOpenMobileNav,
  accounts,
  displayName,
}: TopbarProps) {
  const pathname = usePathname()
  const showScope = SCOPED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 overflow-x-clip border-b border-border bg-background/85 px-3 backdrop-blur md:px-5">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
      >
        <Menu className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden lg:inline-flex"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? (
          <PanelLeftOpen className="size-4" />
        ) : (
          <PanelLeftClose className="size-4" />
        )}
      </Button>

      {/*
        Both controls read the URL via useSearchParams. The Suspense boundary
        keeps a statically prerendered page from bailing out to full
        client-side rendering.
      */}
      {showScope && (
        <div className="hidden items-center gap-2 md:flex">
          <Suspense fallback={<div className="h-9 w-[180px]" />}>
            <AccountSelector accounts={accounts} />
          </Suspense>
          <Suspense fallback={<div className="h-9 w-[160px]" />}>
            <DateRangePicker />
          </Suspense>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button asChild size="sm" className="hidden sm:inline-flex">
          <Link href="/trades/new">
            <Plus className="size-4" />
            Add Trade
          </Link>
        </Button>

        <Separator
          orientation="vertical"
          className="mx-1 hidden h-6 sm:block"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Account menu"
            >
              <Avatar className="size-8 ring-1 ring-border">
                <AvatarFallback>{initials(displayName)}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="truncate font-normal">
              {displayName}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings?tab=profile">Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <form action={signOut} className="w-full">
                <button type="submit" className="w-full cursor-default text-left">
                  Sign out
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
