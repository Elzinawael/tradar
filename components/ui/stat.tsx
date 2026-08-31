import * as React from "react"
import { cn } from "@/lib/utils"

type StatTone = "default" | "positive" | "negative" | "primary"

const toneClass: Record<StatTone, string> = {
  default: "text-foreground",
  positive: "text-positive",
  negative: "text-negative",
  primary: "text-primary",
}

interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: StatTone
}

/**
 * One compact labelled figure — the `<dl>` micro-metric repeated across the
 * replay panel, strategy cards and session summaries. Render inside a
 * {@link StatGrid}.
 */
function Stat({
  label,
  value,
  hint,
  tone = "default",
  className,
  ...props
}: StatProps) {
  return (
    <div className={cn("min-w-0", className)} {...props}>
      <dt className="label-eyebrow truncate">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 font-mono text-sm tabular-nums",
          toneClass[tone],
        )}
      >
        {value}
      </dd>
      {hint && <dd className="text-2xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}

type StatGridColumns = 2 | 3 | 4 | 5 | 6

interface StatGridProps extends React.HTMLAttributes<HTMLDListElement> {
  /** Column count at the widest breakpoint; steps down on smaller screens. */
  columns?: StatGridColumns
}

// Written as literal class strings so Tailwind's scanner picks them up.
const columnClass: Record<StatGridColumns, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-3 sm:grid-cols-6",
}

function StatGrid({ columns = 4, className, ...props }: StatGridProps) {
  return (
    <dl
      className={cn("grid gap-4", columnClass[columns], className)}
      {...props}
    />
  )
}

export { Stat, StatGrid }
