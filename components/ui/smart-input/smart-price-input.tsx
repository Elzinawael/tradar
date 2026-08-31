"use client"

import * as React from "react"
import { SmartNumberInput, type SmartNumberInputProps } from "./smart-number-input"

export type SmartPriceInputProps = Omit<
  SmartNumberInputProps,
  "allowNegative" | "referenceLabel"
> & {
  /** Word for the reset control. Default "Market" (live/replay context). */
  referenceLabel?: string
}

/**
 * Price entry: an instrument-aware numeric field whose `precision` and `step`
 * come from the caller's domain layer, a contextual slider around the
 * reference price, and a reset-to-market control.
 *
 * The reference price (live / replay / backtest) is supplied via
 * `referenceValue` — this component never fetches or assumes a price.
 */
export function SmartPriceInput({
  referenceLabel = "Market",
  slider = true,
  ...props
}: SmartPriceInputProps) {
  return (
    <SmartNumberInput
      referenceLabel={referenceLabel}
      slider={slider}
      allowNegative={false}
      {...props}
    />
  )
}
