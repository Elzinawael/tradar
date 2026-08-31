"use client"

import { useCallback, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import type { TradingAccount } from "@/lib/types"
import { cn } from "@/lib/utils"
import { BrandLogo } from "@/components/brand-logo"
import { SidebarNav } from "./sidebar-nav"
import { Topbar } from "./topbar"
import { MobileTabbar } from "./mobile-tabbar"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/**
 * Persisted desktop-sidebar collapse preference.
 *
 * Backed by localStorage and exposed through useSyncExternalStore so the server
 * and the first client render agree (both expanded) with no hydration mismatch,
 * then the stored value is applied. Same-tab writes notify local listeners;
 * other tabs are picked up through the `storage` event.
 */
const COLLAPSE_KEY = "tradar:sidebar-collapsed"
const collapseListeners = new Set<() => void>()

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1"
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0")
  } catch {
    // localStorage blocked — the toggle still works for this session.
  }
  for (const listener of collapseListeners) listener()
}

function subscribeCollapsed(callback: () => void) {
  collapseListeners.add(callback)
  const onStorage = (event: StorageEvent) => {
    if (event.key === COLLAPSE_KEY) callback()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    collapseListeners.delete(callback)
    window.removeEventListener("storage", onStorage)
  }
}

function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => false,
  )
  const toggle = useCallback(() => writeCollapsed(!readCollapsed()), [])
  return [collapsed, toggle]
}

interface AppShellProps {
  children: React.ReactNode
  accounts: TradingAccount[]
  displayName: string
}

export function AppShell({ children, accounts, displayName }: AppShellProps) {
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center border-b border-sidebar-border px-4",
            collapsed && "justify-center px-0",
          )}
        >
          <Link href="/dashboard" aria-label="TRADAR home">
            <BrandLogo showWordmark={!collapsed} />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <SidebarNav collapsed={collapsed} />
        </div>
      </aside>

      {/* Mobile navigation drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-72 border-sidebar-border bg-sidebar p-0"
        >
          <SheetHeader className="h-14 flex-row items-center border-b border-sidebar-border px-4 py-0">
            <SheetTitle asChild>
              <BrandLogo />
            </SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto scrollbar-thin">
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          onOpenMobileNav={() => setMobileOpen(true)}
          accounts={accounts}
          displayName={displayName}
        />
        <main className="flex-1 px-4 pb-20 md:px-6 lg:pb-0">{children}</main>
      </div>

      <MobileTabbar onOpenNav={() => setMobileOpen(true)} />
    </div>
  )
}
