import type { LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface MetricCardProps {
  label: string
  value: string
  hint?: string
  icon?: LucideIcon
  tone?: "default" | "positive" | "negative" | "primary"
  className?: string
}

const toneClasses: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "text-foreground",
  positive: "text-positive",
  negative: "text-negative",
  primary: "text-primary",
}

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className,
}: MetricCardProps) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground/70" />}
      </div>
      <p
        className={cn(
          "mt-3 font-mono text-2xl font-semibold tabular-nums tracking-tight",
          toneClasses[tone],
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  )
}
