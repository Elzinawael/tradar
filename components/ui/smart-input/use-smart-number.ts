"use client"

import { useCallback, useMemo } from "react"
import {
  countDecimals,
  equalAtPrecision,
  normalizePrecision,
  padToPrecision,
  parseNumeric,
  resolveSliderRange,
  resolveStep,
  sanitizeNumericInput,
  stepValue,
  toPlainString,
} from "@/lib/smart-input/number-field"

export interface SmartSliderConfig {
  /** Explicit lower bound; otherwise derived from the reference. */
  min?: number | null
  /** Explicit upper bound; otherwise derived from the reference. */
  max?: number | null
  /** ± percent of the reference when bounds aren't explicit. Default 0.5. */
  rangePercent?: number
}

export interface SmartNumberConfig {
  /** Controlled raw string — what the field shows and the form submits. */
  value: string
  onValueChange: (raw: string) => void
  /** Decimal places for display and step derivation. */
  precision: number
  /** Explicit step; otherwise 10^-precision. */
  step?: number | null
  /** Bounds used ONLY for stepping — typed values are never silently clamped. */
  min?: number | null
  max?: number | null
  /**
   * Context value from the domain layer (live/replay price, default risk, …).
   * Used for the reference marker and the reset action ONLY. Changing it never
   * rewrites the user's value.
   */
  referenceValue?: number | null
  allowNegative?: boolean
  /** Slider window. `true` uses a reference-relative default; object configures it. */
  slider?: SmartSliderConfig | boolean
}

/**
 * Headless state + handlers for a smart numeric field. All writes to `value`
 * happen in response to an explicit user action (typing, stepping, reset,
 * blur-formatting) — never as a side effect of `referenceValue` changing.
 */
export function useSmartNumber(config: SmartNumberConfig) {
  const {
    value,
    onValueChange,
    precision: rawPrecision,
    step,
    min = null,
    max = null,
    referenceValue = null,
    allowNegative = false,
    slider = false,
  } = config

  const precision = normalizePrecision(rawPrecision)
  const effectiveStep = resolveStep(precision, step)

  const numeric = useMemo(() => parseNumeric(value), [value])
  const isEmpty = value.trim() === ""
  const isInvalid = !isEmpty && numeric === null
  const hasReference =
    referenceValue !== null && Number.isFinite(referenceValue)
  const atReference =
    hasReference && equalAtPrecision(numeric, referenceValue, precision)
  const canReset = hasReference && !atReference

  const onInputChange = useCallback(
    (raw: string) => onValueChange(sanitizeNumericInput(raw, allowNegative)),
    [onValueChange, allowNegative],
  )

  /** Blur reformatting: pad to precision, never truncate. */
  const onBlur = useCallback(() => {
    if (isEmpty) return
    const padded = padToPrecision(value, precision)
    if (padded !== value) onValueChange(padded)
  }, [isEmpty, value, precision, onValueChange])

  const stepBy = useCallback(
    (direction: 1 | -1, multiplier = 1) => {
      const next = stepValue({
        base: numeric,
        direction,
        step: effectiveStep,
        precision,
        multiplier,
        fallback: hasReference ? referenceValue : null,
        min,
        max,
      })
      onValueChange(toPlainString(next, Math.max(precision, countDecimals(next))))
    },
    [
      numeric,
      effectiveStep,
      precision,
      hasReference,
      referenceValue,
      min,
      max,
      onValueChange,
    ],
  )

  const resetToReference = useCallback(() => {
    if (!hasReference) return
    onValueChange(toPlainString(referenceValue as number, precision))
  }, [hasReference, referenceValue, precision, onValueChange])

  const sliderRange = useMemo(() => {
    if (!slider) return null
    const cfg = typeof slider === "object" ? slider : {}
    const base = resolveSliderRange({
      // Anchored to the stable reference, not the value being typed.
      reference: hasReference ? referenceValue : numeric,
      precision,
      explicitMin: cfg.min,
      explicitMax: cfg.max,
      rangePercent: cfg.rangePercent,
    })
    if (!base) return null
    if (numeric === null) return base
    // Keep the current value reachable on the track.
    return { min: Math.min(base.min, numeric), max: Math.max(base.max, numeric) }
  }, [slider, hasReference, referenceValue, numeric, precision])

  return {
    precision,
    step: effectiveStep,
    numeric,
    isEmpty,
    isInvalid,
    hasReference,
    atReference,
    canReset,
    referenceValue,
    sliderRange,
    onInputChange,
    onBlur,
    stepBy,
    resetToReference,
  }
}
