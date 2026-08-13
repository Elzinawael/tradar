import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-b border-border px-4 py-5 md:px-6 lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-balance text-xl font-semibold tracking-tight md:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {(actions || children) && (
        <div className="flex flex-wrap items-center gap-2">
          {children}
          {actions}
        </div>
      )}
    </div>
  )
}
