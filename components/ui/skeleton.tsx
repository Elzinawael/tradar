import { cn } from "@/lib/utils"

/**
 * Loading placeholder. Use for data-heavy areas (tables, charts, metric rows)
 * instead of a bare spinner, so the page keeps its shape while it loads.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
