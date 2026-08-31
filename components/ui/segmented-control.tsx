"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
  disabled?: boolean
}

interface SegmentedControlProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: SegmentedOption<T>[]
  "aria-label"?: string
  className?: string
  size?: "sm" | "default"
}

/**
 * Compact single-select styled like the app's tab strip — for timeframe,
 * order side, order type and similar small enumerations currently rendered as
 * a plain `<Select>`. Arrow keys move the selection.
 *
 * Not yet wired into any page; the form surfaces adopt it in a later phase.
 */
function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  size = "default",
  ...props
}: SegmentedControlProps<T>) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )

  function move(delta: number) {
    const count = options.length
    for (let step = 1; step <= count; step++) {
      const candidate = options[(index + delta * step + count * step) % count]
      if (candidate && !candidate.disabled) {
        onValueChange(candidate.value)
        return
      }
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={props["aria-label"]}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault()
          move(1)
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault()
          move(-1)
        }
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
              size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-sm",
              active
                ? "bg-background text-foreground shadow-sm"
                : "hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export { SegmentedControl }
