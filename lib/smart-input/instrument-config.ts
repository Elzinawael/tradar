/**
 * Adapts the app's existing instrument metadata to Smart Input props.
 *
 * It reads the metadata TRADAR already stores — `price_precision` and
 * `quantity_precision` on `instruments`, surfaced through
 * lib/market-data/registry.ts — and never defines a second source of truth.
 * There is no tick-size column yet, so `step` is derived from precision; when
 * one is added, only this file changes.
 */

import {
  inferPrecisionFromSamples,
  normalizePrecision,
  resolveStep,
} from "./number-field.ts"

export interface NumericFieldMeta {
  precision: number
  step: number
}

/** Price field metadata from an instrument's stored price precision. */
export function priceFieldMeta(
  pricePrecision: number | null | undefined,
): NumericFieldMeta {
  const precision = normalizePrecision(pricePrecision ?? 2)
  return { precision, step: resolveStep(precision) }
}

/** Quantity field metadata from an instrument's stored quantity precision. */
export function quantityFieldMeta(
  quantityPrecision: number | null | undefined,
): NumericFieldMeta {
  const precision = normalizePrecision(quantityPrecision ?? 2)
  return { precision, step: resolveStep(precision) }
}

/**
 * Price precision with a data-derived fallback.
 *
 * The instrument's stored precision when it has one; otherwise inferred from
 * sample prices (e.g. recent candle closes) so a CSV-imported symbol with no
 * registry row still gets sensible behaviour; otherwise 2.
 */
export function resolvePricePrecision(
  stored: number | null | undefined,
  samples: readonly number[] = [],
): number {
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return normalizePrecision(stored)
  }
  return normalizePrecision(inferPrecisionFromSamples(samples, 2))
}
