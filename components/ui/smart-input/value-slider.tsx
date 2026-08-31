"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface ValueSliderProps {
  min: number
  max: number
  step: number
  value: number
  onValueChange: (value: number) => void
  /** Reference marker on the track (e.g. the market / entry price). */
  reference?: number | null
  /** Announced by screen readers instead of the raw number. */
  valueText?: string
  ariaLabel: string
  disabled?: boolean
  className?: string
}

/**
 * The contextual slider behind a Smart Input.
 *
 * A native `<input type="range">` — so ArrowLeft/Right, ArrowUp/Down, Home,
 * End and PageUp/Down all work with no extra code and screen readers announce
 * it as a slider with min/max/now — styled down to a thin, unobtrusive track
 * with a small thumb. A subtle tick marks the reference value.
 */
export function ValueSlider({
  min,
  max,
  step,
  value,
  onValueChange,
  reference,
  valueText,
  ariaLabel,
  disabled,
  className,
}: ValueSliderProps) {
  const span = max - min
  const clamped = Math.min(max, Math.max(min, value))
  const refInRange =
    typeof reference === "number" &&
    Number.isFinite(reference) &&
    span > 0 &&
    reference >= min &&
    reference <= max

  return (
    <div className={cn("relative flex h-4 items-center", className)}>
      {refInRange && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 z-10 h-2.5 w-px -translate-y-1/2 bg-primary/70"
          style={{ left: `${((reference! - min) / span) * 100}%` }}
        />
      )}
      <input
        type="range"
        className="smart-slider w-full"
        min={min}
        max={max}
        step={step > 0 ? step : "any"}
        value={clamped}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuetext={valueText}
        onChange={(event) => onValueChange(Number(event.target.value))}
      />
    </div>
  )
}
