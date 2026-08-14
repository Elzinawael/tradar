"use client"

import { useState } from "react"
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

interface AppShellProps {
  children: React.ReactNode
  accounts: TradingAccount[]
  displayName: string
}

export function AppShell({ children, accounts, displayName }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)
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

      {/* Mobile sidebar sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0">
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
          onToggleCollapse={() => setCollapsed((v) => !v)}
          onOpenMobileNav={() => setMobileOpen(true)}
          accounts={accounts}
          displayName={displayName}
        />
        <main className="flex-1 px-4 pb-20 md:px-6 lg:pb-0">{children}</main>
      </div>

      <MobileTabbar />
    </div>
  )
}
