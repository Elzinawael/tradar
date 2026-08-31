"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { activeNavHref, navSections } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface SidebarNavProps {
  collapsed: boolean
  onNavigate?: () => void
}

export function SidebarNav({ collapsed, onNavigate }: SidebarNavProps) {
  const pathname = usePathname()
  const active = activeNavHref(pathname)

  return (
    <TooltipProvider delayDuration={0}>
      <nav className="flex flex-col gap-5 px-3 py-4" aria-label="Primary">
        {navSections.map((section, sectionIndex) => (
          <div
            key={section.title ?? `section-${sectionIndex}`}
            className={cn(
              "flex flex-col gap-1",
              // The trailing utility group is set off by a rule, not a heading.
              !section.title && "border-t border-sidebar-border pt-4",
            )}
          >
            {section.title && !collapsed && (
              <p className="px-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-sidebar-foreground/45">
                {section.title}
              </p>
            )}
            {section.items.map((item) => {
              const isActive = item.href === active
              const link = (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    collapsed && "justify-center px-0",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  )}
                >
                  <item.icon
                    className={cn(
                      "size-4 shrink-0",
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground group-hover:text-sidebar-foreground",
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {isActive && !collapsed && (
                    <span className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" />
                  )}
                </Link>
              )

              if (collapsed) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                )
              }
              return link
            })}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  )
}
