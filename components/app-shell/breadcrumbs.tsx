import Link from "next/link"
import { ChevronRight } from "lucide-react"
import type { Crumb } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/**
 * Breadcrumb trail for deep routes. Rendered by {@link PageHeader} when a page
 * passes `breadcrumbs`; top-level pages omit it. The last crumb is the current
 * page and is never a link.
 */
export function Breadcrumbs({
  items,
  className,
}: {
  items: Crumb[]
  className?: string
}) {
  if (items.length === 0) return null

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground",
        className,
      )}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <span
            key={`${item.label}-${index}`}
            className="flex items-center gap-x-1.5"
          >
            {index > 0 && (
              <ChevronRight
                className="size-3 shrink-0 text-muted-foreground/50"
                aria-hidden
              />
            )}
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={cn("truncate", isLast && "text-foreground")}
                aria-current={isLast ? "page" : undefined}
              >
                {item.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
