import * as React from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Text input with a leading search icon — the pattern the trades, session and
 * instrument-catalog filter bars each hand-write. Presentational only: the
 * caller still owns the `<form>` / URL-state wiring.
 */
const SearchInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & { wrapperClassName?: string }
>(({ className, wrapperClassName, ...props }, ref) => (
  <div className={cn("relative", wrapperClassName)}>
    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    <Input ref={ref} className={cn("pl-8", className)} {...props} />
  </div>
))
SearchInput.displayName = "SearchInput"

export { SearchInput }
