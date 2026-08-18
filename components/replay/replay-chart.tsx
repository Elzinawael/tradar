"use client"

import { useEffect, useMemo, useRef } from "react"
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type SeriesMarkerBarPosition,
  type SeriesMarkerShape,
  type UTCTimestamp,
} from "lightweight-charts"
import type { Candle } from "@/lib/candles"

/** A horizontal level to draw on the price scale. */
export interface ChartLevel {
  price: number
  label: string
  kind: "entry" | "stop" | "target" | "current"
}

/** An execution to mark on the candle it occurred on. */
export interface ChartMarker {
  ts: string
  kind: "entry-long" | "entry-short" | "exit-stop" | "exit-target" | "exit-manual"
  label: string
}

interface ReplayChartProps {
  /** Bars already revealed. Never contains anything past the cursor. */
  candles: Candle[]
  /** Open-position levels. Removed automatically when the position closes. */
  levels?: ChartLevel[]
  /** Entry and exit markers, derived from stored trade timestamps. */
  markers?: ChartMarker[]
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
 * Levels and markers are likewise passed in from server-derived state; nothing
 * here is computed from a client-side guess at price or position.
 */
export function ReplayChart({
  candles,
  levels = [],
  markers = [],
  height = 420,
}: ReplayChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])
  // The series is typed over `Time`, so the markers plugin is too.
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)

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

    const token = (_name: string, fallback: string) => fallback

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
    markersRef.current = createSeriesMarkers(series, [])

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
      markersRef.current = null
      priceLinesRef.current = []
    }
  }, [height])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    series.setData(data)
  }, [data])

  // Price lines are recreated whenever the level set changes. Removing the old
  // ones first is what makes the levels vanish when a position closes — the
  // parent simply stops passing them.
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return

    for (const line of priceLinesRef.current) {
      series.removePriceLine(line)
    }

    const styleFor = (kind: ChartLevel["kind"]) => {
      switch (kind) {
        case "stop":
          return { color: "#ef4444", lineStyle: LineStyle.Dashed }
        case "target":
          return { color: "#22c55e", lineStyle: LineStyle.Dashed }
        case "current":
          return { color: "#8b8b8b", lineStyle: LineStyle.Dotted }
        default:
          return { color: "#d4a437", lineStyle: LineStyle.Solid }
      }
    }

    priceLinesRef.current = levels
      .filter((level) => Number.isFinite(level.price))
      .map((level) => {
        const { color, lineStyle } = styleFor(level.kind)
        return series.createPriceLine({
          price: level.price,
          color,
          lineStyle,
          lineWidth: 1,
          axisLabelVisible: true,
          title: level.label,
        })
      })
  }, [levels])

  useEffect(() => {
    const plugin = markersRef.current
    if (!plugin) return

    // Typed narrowly: SeriesMarker is a discriminated union over bar- vs
    // price-anchored positions, so the position must stay a bar position
    // rather than widening to the union.
    const styleFor = (
      kind: ChartMarker["kind"],
    ): {
      position: SeriesMarkerBarPosition
      shape: SeriesMarkerShape
      color: string
    } => {
      switch (kind) {
        case "entry-long":
          return { position: "belowBar", shape: "arrowUp", color: "#22c55e" }
        case "entry-short":
          return { position: "aboveBar", shape: "arrowDown", color: "#ef4444" }
        case "exit-stop":
          return { position: "aboveBar", shape: "circle", color: "#ef4444" }
        case "exit-target":
          return { position: "aboveBar", shape: "circle", color: "#22c55e" }
        default:
          return { position: "aboveBar", shape: "square", color: "#8b8b8b" }
      }
    }

    plugin.setMarkers(
      markers
        .map((marker) => {
          const time = (new Date(marker.ts).getTime() / 1000) as UTCTimestamp
          return {
            ...styleFor(marker.kind),
            time,
            text: marker.label,
          }
        })
        .sort((a, b) => (a.time as number) - (b.time as number)),
    )
  }, [markers])

  return (
    <div
      ref={containerRef}
      className="w-full"
      role="img"
      aria-label={`Candlestick chart showing ${candles.length} bars up to the replay cursor`}
    />
  )
}
