"use client"

import * as React from "react"
import { SmartNumberInput, type SmartNumberInputProps } from "./smart-number-input"

export type SmartQuantityInputProps = Omit<
  SmartNumberInputProps,
  "allowNegative"
> & {
  referenceLabel?: string
}

/**
 * Quantity / position-size entry. Uses the instrument's `quantityPrecision`
 * via the caller-supplied `precision`. No slider by default — size is usually
 * either derived (from risk + stop, elsewhere) or typed exactly.
 */
export function SmartQuantityInput({
  referenceLabel = "Suggested",
  slider = false,
  ...props
}: SmartQuantityInputProps) {
  return (
    <SmartNumberInput
      referenceLabel={referenceLabel}
      slider={slider}
      allowNegative={false}
      {...props}
    />
  )
}
