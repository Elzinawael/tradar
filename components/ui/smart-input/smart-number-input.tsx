"use client"

import * as React from "react"
import { RotateCcw } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { toGroupedString, toPlainString } from "@/lib/smart-input/number-field"
import { useSmartNumber, type SmartNumberConfig } from "./use-smart-number"
import { ValueSlider } from "./value-slider"

export interface SmartNumberInputProps
  extends Omit<SmartNumberConfig, "value" | "onValueChange">,
    Omit<
      React.InputHTMLAttributes<HTMLInputElement>,
      "value" | "onChange" | "type" | "min" | "max" | "step" | "prefix"
    > {
  value: string
  onValueChange: (raw: string) => void
  /** Accessible name — also used to name the slider. */
  ariaLabel: string
  /** Word shown in the reset control (after the ↻). Default "Reference". */
  referenceLabel?: string
  /** Static suffix inside the field, e.g. "%". */
  suffix?: React.ReactNode
  /** Force the invalid style (in addition to the field's own parse check). */
  invalid?: boolean
  loading?: boolean
  inputClassName?: string
  wrapperClassName?: string
}

/**
 * Base smart numeric field: a real text input (always available and
 * form-submittable) plus keyboard stepping, an optional contextual slider and
 * a reset-to-reference control. Wrap it in the Phase 1 `<Field>` for the
 * visible label, hint and error.
 */
export const SmartNumberInput = React.forwardRef<
  HTMLInputElement,
  SmartNumberInputProps
>(function SmartNumberInput(
  {
    value,
    onValueChange,
    precision,
    step,
    min,
    max,
    referenceValue,
    allowNegative,
    slider,
    ariaLabel,
    referenceLabel = "Reference",
    suffix,
    invalid,
    loading,
    disabled,
    inputClassName,
    wrapperClassName,
    id,
    name,
    placeholder,
    ...rest
  },
  ref,
) {
  const sm = useSmartNumber({
    value,
    onValueChange,
    precision,
    step,
    min,
    max,
    referenceValue,
    allowNegative,
    slider,
  })

  const isDisabled = Boolean(disabled) || Boolean(loading)

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (isDisabled) return
    const multiplier = event.shiftKey ? 10 : 1
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault()
        sm.stepBy(1, multiplier)
        break
      case "ArrowDown":
        event.preventDefault()
        sm.stepBy(-1, multiplier)
        break
      case "PageUp":
        event.preventDefault()
        sm.stepBy(1, 10 * multiplier)
        break
      case "PageDown":
        event.preventDefault()
        sm.stepBy(-1, 10 * multiplier)
        break
      default:
        break
    }
  }

  const referenceText = sm.hasReference
    ? toGroupedString(sm.referenceValue as number, sm.precision)
    : null

  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            ref={ref}
            id={id}
            name={name}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            spellCheck={false}
            value={value}
            placeholder={placeholder}
            disabled={isDisabled}
            aria-label={ariaLabel}
            aria-invalid={invalid || sm.isInvalid || undefined}
            aria-busy={loading || undefined}
            onKeyDown={onKeyDown}
            onChange={(event) => sm.onInputChange(event.target.value)}
            onBlur={sm.onBlur}
            className={cn(
              "font-mono tabular-nums",
              suffix && "pr-8",
              inputClassName,
            )}
            {...rest}
          />
          {suffix && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {suffix}
            </span>
          )}
        </div>

        {referenceText && (
          <button
            type="button"
            onClick={sm.resetToReference}
            disabled={isDisabled || !sm.canReset}
            title={
              sm.atReference
                ? `At ${referenceLabel.toLowerCase()}`
                : `Reset to ${referenceLabel.toLowerCase()} ${referenceText}`
            }
            aria-label={`Reset to ${referenceLabel.toLowerCase()} ${referenceText}`}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-border px-2 font-mono text-2xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              sm.canReset
                ? "text-muted-foreground hover:bg-accent hover:text-foreground"
                : "cursor-default text-text-tertiary",
            )}
          >
            <RotateCcw
              className={cn("size-3", !sm.canReset && "opacity-40")}
              aria-hidden
            />
            {referenceText}
          </button>
        )}
      </div>

      {sm.sliderRange && (
        <ValueSlider
          ariaLabel={`${ariaLabel} slider`}
          min={sm.sliderRange.min}
          max={sm.sliderRange.max}
          step={sm.step}
          value={sm.numeric ?? sm.referenceValue ?? sm.sliderRange.min}
          reference={sm.referenceValue}
          disabled={isDisabled}
          valueText={
            sm.numeric !== null
              ? `${toGroupedString(sm.numeric, sm.precision)}${
                  sm.atReference ? ` (${referenceLabel.toLowerCase()})` : ""
                }`
              : undefined
          }
          onValueChange={(next) =>
            onValueChange(toPlainString(next, sm.precision))
          }
        />
      )}
    </div>
  )
})
