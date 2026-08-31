"use client"

import * as React from "react"
import { SmartNumberInput, type SmartNumberInputProps } from "./smart-number-input"

export type SmartPercentInputProps = Omit<
  SmartNumberInputProps,
  "allowNegative" | "suffix" | "min" | "max"
> & {
  /** Lower bound for stepping. Default 0. */
  min?: number | null
  /** Upper bound for stepping. Default 100. */
  max?: number | null
}

/**
 * Percentage entry (risk %, adherence, …). Bounded 0–100 for stepping, `%`
 * suffix, and a compact slider over a practical sub-range by default.
 */
export function SmartPercentInput({
  min = 0,
  max = 100,
  precision = 2,
  referenceLabel = "Reset",
  slider = { min: 0, max: 10 },
  ...props
}: SmartPercentInputProps) {
  return (
    <SmartNumberInput
      min={min}
      max={max}
      precision={precision}
      suffix="%"
      referenceLabel={referenceLabel}
      slider={slider}
      allowNegative={false}
      {...props}
    />
  )
}
