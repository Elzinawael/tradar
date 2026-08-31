"use client"

import * as React from "react"
import {
  roundToPrecision,
  stepValue,
  toGroupedString,
} from "@/lib/smart-input/number-field"
import { cn } from "@/lib/utils"

export type PriceLevelTone = "entry" | "stop" | "target"

export interface PriceLevelMarker {
  key: string
  price: number
  label: string
  tone: PriceLevelTone
  /** Omit to render a fixed (non-draggable) marker, e.g. a market entry. */
  onChange?: (price: number) => void
}

export interface PriceLevelBand {
  from: number
  to: number
  tone: "risk" | "reward"
}

interface PriceLevelTrackProps {
  min: number
  max: number
  step: number
  precision: number
  markers: PriceLevelMarker[]
  bands?: PriceLevelBand[]
  disabled?: boolean
  className?: string
}

const MARKER_COLOR: Record<PriceLevelTone, string> = {
  entry: "bg-primary",
  stop: "bg-negative",
  target: "bg-positive",
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * A shared horizontal price axis for the trading ticket: entry, stop and
 * target on ONE track, with tinted risk / reward bands, so the relationship
 * between the three prices is immediately readable.
 *
 * Each marker is a `role="slider"` handle — draggable with a pointer and
 * adjustable with the keyboard (arrows step by one tick, Shift ×10, Page keys
 * ×10, Home / End jump to the ends). Typed values in the ticket's number
 * fields stay authoritative; the track just emits a new value like any edit.
 * The visible line is deliberately thin; the interactive area is not.
 */
export function PriceLevelTrack({
  min,
  max,
  step,
  precision,
  markers,
  bands = [],
  disabled,
  className,
}: PriceLevelTrackProps) {
  const trackRef = React.useRef<HTMLDivElement>(null)
  // While a marker is being dragged, `drag` holds the marker key and the
  // window frozen at pointer-down, so the handle tracks the pointer even as
  // the ticket recomputes its bounds from the changing value.
  const [drag, setDrag] = React.useState<{
    key: string
    min: number
    max: number
  } | null>(null)

  const win = drag ? { min: drag.min, max: drag.max } : { min, max }
  const span = win.max - win.min
  const pct = (price: number) =>
    span > 0 ? clamp01((price - win.min) / span) * 100 : 50

  function priceFromClientX(clientX: number): number | null {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const ratio = clamp01((clientX - rect.left) / rect.width)
    return roundToPrecision(win.min + ratio * span, precision)
  }

  function onPointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    marker: PriceLevelMarker,
  ) {
    if (disabled || !marker.onChange) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ key: marker.key, min, max })
  }

  function onPointerMove(
    event: React.PointerEvent<HTMLButtonElement>,
    marker: PriceLevelMarker,
  ) {
    if (drag?.key !== marker.key || !marker.onChange) return
    const next = priceFromClientX(event.clientX)
    if (next !== null) marker.onChange(next)
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDrag(null)
  }

  function onKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    marker: PriceLevelMarker,
  ) {
    if (disabled || !marker.onChange) return
    const multiplier = event.shiftKey ? 10 : 1
    let next: number | null = null
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = stepValue({ base: marker.price, direction: 1, step, precision, multiplier })
        break
      case "ArrowLeft":
      case "ArrowDown":
        next = stepValue({ base: marker.price, direction: -1, step, precision, multiplier })
        break
      case "PageUp":
        next = stepValue({ base: marker.price, direction: 1, step, precision, multiplier: 10 })
        break
      case "PageDown":
        next = stepValue({ base: marker.price, direction: -1, step, precision, multiplier: 10 })
        break
      case "Home":
        next = roundToPrecision(min, precision)
        break
      case "End":
        next = roundToPrecision(max, precision)
        break
      default:
        return
    }
    event.preventDefault()
    if (next !== null) marker.onChange(next)
  }

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative h-12 touch-none select-none",
        disabled && "opacity-50",
        className,
      )}
    >
      {/* baseline */}
      <div className="absolute inset-x-0 top-4 h-0.5 -translate-y-1/2 rounded-full bg-border" />

      {/* risk / reward bands */}
      {bands.map((band, index) => {
        const lo = Math.min(band.from, band.to)
        const hi = Math.max(band.from, band.to)
        return (
          <div
            key={`band-${index}`}
            aria-hidden
            className={cn(
              "absolute top-4 h-1 -translate-y-1/2 rounded-full",
              band.tone === "risk" ? "bg-negative/25" : "bg-positive/25",
            )}
            style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%` }}
          />
        )
      })}

      {/* markers */}
      {markers.map((marker) => {
        const left = pct(marker.price)
        const draggable = Boolean(marker.onChange) && !disabled
        return (
          <div
            key={marker.key}
            className="absolute top-0 h-full"
            style={{ left: `${left}%` }}
          >
            <button
              type="button"
              role={draggable ? "slider" : undefined}
              disabled={!draggable}
              aria-label={
                draggable
                  ? `${marker.label} price`
                  : `${marker.label} ${toGroupedString(marker.price, precision)}`
              }
              aria-valuemin={draggable ? min : undefined}
              aria-valuemax={draggable ? max : undefined}
              aria-valuenow={draggable ? marker.price : undefined}
              aria-valuetext={
                draggable
                  ? `${marker.label} ${toGroupedString(marker.price, precision)}`
                  : undefined
              }
              onPointerDown={(event) => onPointerDown(event, marker)}
              onPointerMove={(event) => onPointerMove(event, marker)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => onKeyDown(event, marker)}
              className={cn(
                // Generous, invisible hit area; thin visible mark.
                "group absolute left-1/2 top-0 flex h-10 w-8 -translate-x-1/2 cursor-ew-resize touch-none items-start justify-center rounded-sm focus-visible:outline-none",
                !draggable && "cursor-default",
              )}
            >
              <span
                className={cn(
                  "block h-8 w-0.5 rounded-full",
                  MARKER_COLOR[marker.tone],
                )}
              />
              <span
                aria-hidden
                className={cn(
                  "absolute top-[13px] size-2.5 -translate-y-1/2 rounded-full border-2 border-background transition-shadow group-focus-visible:ring-2 group-focus-visible:ring-ring",
                  MARKER_COLOR[marker.tone],
                  drag?.key === marker.key && "ring-2 ring-ring",
                )}
              />
            </button>
            <span
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 whitespace-nowrap text-2xs text-muted-foreground"
            >
              {marker.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
