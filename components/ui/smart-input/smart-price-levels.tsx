"use client"

import * as React from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import {
  parseNumeric,
  roundToPrecision,
  resolveStep,
  toGroupedString,
  toPlainString,
} from "@/lib/smart-input/number-field"
import {
  priceLevelGeometry,
  suggestStop,
  suggestTarget,
  type TradeDirection,
} from "@/lib/smart-input/price-levels"
import { cn, formatCurrency } from "@/lib/utils"
import { SmartPriceInput } from "./smart-price-input"
import {
  PriceLevelTrack,
  type PriceLevelBand,
  type PriceLevelMarker,
} from "./price-level-track"

export interface SmartPriceLevelsStats {
  riskPercent?: number | null
  riskAmount?: number | null
  positionSize?: number | null
}

export interface SmartPriceLevelsProps {
  direction: TradeDirection
  precision: number
  /** Market / replay reference price. Entry sits here unless the user moves it. */
  referencePrice: number | null

  /** True for limit/stop orders — entry is user-set. False for market. */
  entryEditable?: boolean
  entryValue?: string
  onEntryChange?: (raw: string) => void
  entryName?: string
  entryLabel?: string
  entryError?: string

  stopValue: string
  onStopChange: (raw: string) => void
  stopName?: string
  stopError?: string

  targetEnabled: boolean
  onToggleTarget: (enabled: boolean) => void
  targetValue: string
  onTargetChange: (raw: string) => void
  targetName?: string
  targetError?: string

  /** Calculated context — supplied by the caller from its existing helpers. */
  stats?: SmartPriceLevelsStats
  disabled?: boolean
  className?: string
}

function DistanceChip({
  distance,
  percent,
  precision,
  tone,
}: {
  distance: number | null
  percent: number | null
  precision: number
  tone: "risk" | "reward"
}) {
  if (distance === null) return null
  return (
    <span
      className={cn(
        "font-mono text-2xs tabular-nums",
        tone === "risk" ? "text-negative" : "text-positive",
      )}
    >
      {toGroupedString(distance, precision)}
      {percent !== null && (
        <span className="text-muted-foreground">
          {" "}
          ({percent > 0 ? "+" : ""}
          {percent.toFixed(2)}%)
        </span>
      )}
    </span>
  )
}

/**
 * The unified Entry / Stop / Take-profit control.
 *
 * One shared price axis shows the three levels and the risk (red) / reward
 * (green) zones between them, direction-aware. The exact prices are edited
 * through Smart Inputs below; dragging a marker on the axis is just another
 * edit. Take profit is optional and revealed with "+ Add take profit".
 *
 * All trading maths (position size, risk, R-multiple, level validity) stay
 * with the caller and `lib/trade-math` / `lib/replay-engine`; this component
 * only measures distances for display.
 */
export function SmartPriceLevels({
  direction,
  precision,
  referencePrice,
  entryEditable = false,
  entryValue = "",
  onEntryChange,
  entryName,
  entryLabel = "Entry price",
  entryError,
  stopValue,
  onStopChange,
  stopName,
  stopError,
  targetEnabled,
  onToggleTarget,
  targetValue,
  onTargetChange,
  targetName,
  targetError,
  stats,
  disabled,
  className,
}: SmartPriceLevelsProps) {
  const step = resolveStep(precision)

  const entryPrice = entryEditable ? parseNumeric(entryValue) : referencePrice
  const stopPrice = parseNumeric(stopValue)
  const targetPrice = targetEnabled ? parseNumeric(targetValue) : null

  const suggestedStop =
    entryPrice !== null ? suggestStop(entryPrice, direction, precision) : null
  const suggestedTarget =
    entryPrice !== null ? suggestTarget(entryPrice, direction, precision) : null

  const geo = priceLevelGeometry({
    entry: entryPrice,
    stop: stopPrice,
    target: targetPrice,
  })

  // Track window — anchored to entry, wide enough to hold the set levels.
  const trackAnchor = entryPrice ?? referencePrice
  const trackWindow =
    trackAnchor !== null && Number.isFinite(trackAnchor) && trackAnchor !== 0
      ? (() => {
          const maxDistance = Math.max(
            0,
            stopPrice !== null ? Math.abs(stopPrice - trackAnchor) : 0,
            targetPrice !== null ? Math.abs(targetPrice - trackAnchor) : 0,
          )
          const half = Math.max(
            Math.abs(trackAnchor) * 0.006,
            maxDistance * 1.35,
            step * 10,
          )
          return {
            min: roundToPrecision(trackAnchor - half, precision),
            max: roundToPrecision(trackAnchor + half, precision),
          }
        })()
      : null

  const markers: PriceLevelMarker[] = [
    ...(entryPrice !== null
      ? [
          {
            key: "entry",
            price: entryPrice,
            label: "Entry",
            tone: "entry" as const,
            onChange:
              entryEditable && onEntryChange && !disabled
                ? (price: number) =>
                    onEntryChange(toPlainString(price, precision))
                : undefined,
          },
        ]
      : []),
    ...(stopPrice !== null
      ? [
          {
            key: "stop",
            price: stopPrice,
            label: "SL",
            tone: "stop" as const,
            onChange: disabled
              ? undefined
              : (price: number) => onStopChange(toPlainString(price, precision)),
          },
        ]
      : []),
    ...(targetPrice !== null
      ? [
          {
            key: "target",
            price: targetPrice,
            label: "TP",
            tone: "target" as const,
            onChange: disabled
              ? undefined
              : (price: number) =>
                  onTargetChange(toPlainString(price, precision)),
          },
        ]
      : []),
  ]

  const bands: PriceLevelBand[] = [
    ...(entryPrice !== null && stopPrice !== null
      ? [{ from: entryPrice, to: stopPrice, tone: "risk" as const }]
      : []),
    ...(entryPrice !== null && targetPrice !== null
      ? [{ from: entryPrice, to: targetPrice, tone: "reward" as const }]
      : []),
  ]

  const showTrack = trackWindow !== null && markers.length > 0

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {showTrack && (
        <PriceLevelTrack
          min={trackWindow.min}
          max={trackWindow.max}
          step={step}
          precision={precision}
          markers={markers}
          bands={bands}
          disabled={disabled}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Entry */}
        {entryEditable ? (
          <Field label={entryLabel} htmlFor={entryName} error={entryError}>
            <SmartPriceInput
              id={entryName}
              name={entryName}
              ariaLabel={entryLabel}
              value={entryValue}
              onValueChange={onEntryChange ?? (() => {})}
              precision={precision}
              referenceValue={referencePrice}
              referenceLabel="Market"
              slider={false}
              invalid={Boolean(entryError)}
              disabled={disabled}
            />
          </Field>
        ) : (
          <Field label="Entry">
            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-background/40 px-3 font-mono text-sm tabular-nums">
              <span className="label-eyebrow">Market</span>
              <span>
                {referencePrice !== null
                  ? toGroupedString(referencePrice, precision)
                  : "—"}
              </span>
            </div>
          </Field>
        )}

        {/* Stop loss */}
        <Field
          label="Stop loss"
          htmlFor={stopName}
          error={stopError}
          hint={
            <DistanceChip
              distance={geo.riskDistance}
              percent={geo.stopPercent}
              precision={precision}
              tone="risk"
            />
          }
        >
          <SmartPriceInput
            id={stopName}
            name={stopName}
            ariaLabel="Stop loss"
            value={stopValue}
            onValueChange={onStopChange}
            precision={precision}
            referenceValue={suggestedStop}
            referenceLabel="Suggested"
            slider={false}
            placeholder="Required"
            invalid={Boolean(stopError)}
            disabled={disabled}
          />
        </Field>

        {/* Take profit — optional */}
        {targetEnabled ? (
          <Field
            label={
              <span className="flex items-center justify-between gap-2">
                Take profit
                <button
                  type="button"
                  onClick={() => onToggleTarget(false)}
                  disabled={disabled}
                  className="inline-flex items-center gap-0.5 text-2xs text-muted-foreground transition-colors hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Remove take profit"
                >
                  <X className="size-3" />
                  Remove
                </button>
              </span>
            }
            htmlFor={targetName}
            error={targetError}
            hint={
              <DistanceChip
                distance={geo.rewardDistance}
                percent={geo.targetPercent}
                precision={precision}
                tone="reward"
              />
            }
          >
            <SmartPriceInput
              id={targetName}
              name={targetName}
              ariaLabel="Take profit"
              value={targetValue}
              onValueChange={onTargetChange}
              precision={precision}
              referenceValue={suggestedTarget}
              referenceLabel="Suggested"
              slider={false}
              invalid={Boolean(targetError)}
              disabled={disabled}
            />
          </Field>
        ) : (
          <div className="flex flex-col justify-end">
            {targetName && (
              <input type="hidden" name={targetName} value="" readOnly />
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 justify-start font-normal text-muted-foreground"
              onClick={() => onToggleTarget(true)}
              disabled={disabled || entryPrice === null}
            >
              <Plus className="size-4" />
              Add take profit
            </Button>
          </div>
        )}
      </div>

      {/* Calculated context — only values that exist */}
      {(geo.riskReward !== null ||
        stats?.positionSize != null ||
        stats?.riskAmount != null) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
          {stats?.riskAmount != null && (
            <span className="text-muted-foreground">
              Risk{" "}
              <span className="font-mono tabular-nums text-foreground">
                {formatCurrency(stats.riskAmount)}
                {stats.riskPercent != null && ` (${stats.riskPercent}%)`}
              </span>
            </span>
          )}
          {stats?.positionSize != null && (
            <span className="text-muted-foreground">
              Size{" "}
              <span className="font-mono tabular-nums text-foreground">
                {stats.positionSize}
              </span>
            </span>
          )}
          {geo.riskReward !== null && (
            <span className="text-muted-foreground">
              R:R{" "}
              <span
                className={cn(
                  "font-mono tabular-nums",
                  geo.riskReward >= 1 ? "text-positive" : "text-foreground",
                )}
              >
                1 : {geo.riskReward.toFixed(2)}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
