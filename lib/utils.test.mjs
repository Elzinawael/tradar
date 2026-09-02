import { test } from "node:test"
import assert from "node:assert/strict"
import { formatMarketDate, formatMarketDateTime } from "./utils.ts"

/**
 * Regression guard for the React #418 hydration mismatch in the replay player:
 * these formatters must be deterministic regardless of the host's locale or
 * time zone, so a Client Component renders the same text on the server and in
 * the browser.
 */

test("formatMarketDateTime: fixed en-US medium date + short time in UTC", () => {
  assert.equal(
    formatMarketDateTime("2026-06-01T01:42:00Z"),
    "Jun 1, 2026, 1:42 AM",
  )
})

test("formatMarketDate: fixed en-US medium date in UTC", () => {
  assert.equal(formatMarketDate("2026-06-01T23:30:00Z"), "Jun 1, 2026")
})

test("formatMarketDateTime: renders in UTC, not the host time zone", () => {
  // 23:30Z would roll into the next day in any eastern zone and the previous
  // day in any western zone if the host TZ leaked in. It must stay Jun 1.
  assert.equal(
    formatMarketDateTime("2026-06-01T23:30:00Z"),
    "Jun 1, 2026, 11:30 PM",
  )
})

test("formatMarketDate/DateTime: accept Date and epoch millis too", () => {
  const ms = Date.parse("2026-12-25T00:00:00Z")
  assert.equal(formatMarketDateTime(ms), "Dec 25, 2026, 12:00 AM")
  assert.equal(formatMarketDate(new Date(ms)), "Dec 25, 2026")
})
