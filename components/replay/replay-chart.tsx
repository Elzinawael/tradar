"use client"

import { useEffect, useMemo, useRef } from "react"
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts"
import type { Candle } from "@/lib/candles"

interface ReplayChartProps {
  /** Bars already revealed. Never contains anything past the cursor. */
  candles: Candle[]
  height?: number
}

/**
 * Candlestick chart for replay.
 *
 * Uses lightweight-charts rather than recharts, which has no candlestick
 * series, and renders to canvas so a long replay stays smooth where an SVG
 * chart would not.
 *
 * Look-ahead: this component only ever receives bars at or before the cursor,
 * and does no filtering of its own — the visible set is decided upstream in
 * `visibleCandles()`, so there is one place to reason about it.
 *
 * Colours are read from the TRADAR design tokens at mount so the chart matches
 * the rest of the app instead of shipping its own palette.
 */
export function ReplayChart({ candles, height = 420 }: ReplayChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)

  const data = useMemo(
    () =>
      candles
        .map((c) => ({
          time: (new Date(c.ts).getTime() / 1000) as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
        .sort((a, b) => (a.time as number) - (b.time as number)),
    [candles],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const styles = getComputedStyle(document.documentElement)
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback

    const chart = createChart(container, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: token("--color-muted-foreground", "#8b8b8b"),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: token("--color-border", "#2a2a2a") },
        horzLines: { color: token("--color-border", "#2a2a2a") },
      },
      rightPriceScale: { borderColor: token("--color-border", "#2a2a2a") },
      timeScale: {
        borderColor: token("--color-border", "#2a2a2a"),
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: token("--color-positive", "#22c55e"),
      downColor: token("--color-negative", "#ef4444"),
      borderUpColor: token("--color-positive", "#22c55e"),
      borderDownColor: token("--color-negative", "#ef4444"),
      wickUpColor: token("--color-positive", "#22c55e"),
      wickDownColor: token("--color-negative", "#ef4444"),
    })

    chartRef.current = chart
    seriesRef.current = series

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) chart.applyOptions({ width })
    })
    observer.observe(container)
    chart.applyOptions({ width: container.clientWidth })

    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [height])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    series.setData(data)
  }, [data])

  return (
    <div
      ref={containerRef}
      className="w-full"
      role="img"
      aria-label={`Candlestick chart showing ${candles.length} bars up to the replay cursor`}
    />
  )
}
