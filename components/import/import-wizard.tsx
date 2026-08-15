"use client"

import { useActionState, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import {
  AlertCircle,
  Check,
  FileUp,
  Loader2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  autoMapHeaders,
  buildPreview,
  FIELD_LABELS,
  IMPORT_FIELDS,
  parseCsv,
  REQUIRED_FIELDS,
  type ImportField,
} from "@/lib/csv-import"
import { importTrades } from "@/lib/actions/import"
import {
  initialImportState,
  type ImportActionState,
} from "@/lib/actions/state"
import type { TradingAccount } from "@/lib/types"
import { cn, formatCurrency } from "@/lib/utils"

const UNMAPPED = "unmapped"

function SubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Upload className="size-4" />
      )}
      Import {count} trade{count === 1 ? "" : "s"}
    </Button>
  )
}

/**
 * Three-step import: choose a file, confirm the column mapping, review the
 * preview and commit.
 *
 * Parsing and validation run in the browser purely so the preview is instant.
 * The server re-parses the same content with the same functions before
 * inserting anything, so nothing here is trusted.
 */
export function ImportWizard({ accounts }: { accounts: TradingAccount[] }) {
  const [csv, setCsv] = useState("")
  const [fileName, setFileName] = useState("")
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<Record<number, ImportField>>({})
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "")

  const [state, formAction] = useActionState<ImportActionState, FormData>(
    importTrades,
    initialImportState,
  )

  const rows = useMemo(() => (csv ? parseCsv(csv) : []), [csv])
  const headers = rows[0] ?? []

  const preview = useMemo(
    () => (rows.length > 0 ? buildPreview(rows, mapping, { hasHeader }) : null),
    [rows, mapping, hasHeader],
  )

  const mappedFields = new Set(Object.values(mapping))
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f))

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setCsv(text)
    setFileName(file.name)
    const parsed = parseCsv(text)
    setMapping(parsed.length > 0 ? autoMapHeaders(parsed[0]) : {})
  }

  function setColumn(index: number, field: string) {
    setMapping((prev) => {
      const next = { ...prev }
      if (field === UNMAPPED) {
        delete next[index]
        return next
      }
      // A field can only come from one column; clear any previous holder.
      for (const key of Object.keys(next)) {
        if (next[Number(key)] === field) delete next[Number(key)]
      }
      next[index] = field as ImportField
      return next
    })
  }

  return (
    <div className="space-y-4">
      {/* Step 1 — file */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            1. Choose a CSV file
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label
            className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 transition-colors hover:border-primary/40 hover:bg-muted/40"
            htmlFor="csv-file"
          >
            <FileUp className="size-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {fileName || "Select a CSV exported from your broker"}
            </span>
          </label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="sr-only"
          />

          {rows.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="size-4 accent-primary"
              />
              First row contains column names
            </label>
          )}
        </CardContent>
      </Card>

      {/* Step 2 — mapping */}
      {rows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              2. Match your columns
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {missingRequired.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-foreground">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>
                  Still needed:{" "}
                  {missingRequired.map((f) => FIELD_LABELS[f]).join(", ")}
                </span>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {headers.map((header, index) => (
                <div key={index} className="flex flex-col gap-1.5">
                  <Label className="truncate text-xs text-muted-foreground">
                    {hasHeader ? header || `Column ${index + 1}` : `Column ${index + 1}`}
                  </Label>
                  <Select
                    value={mapping[index] ?? UNMAPPED}
                    onValueChange={(v) => setColumn(index, v)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNMAPPED}>Ignore</SelectItem>
                      {IMPORT_FIELDS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {FIELD_LABELS[f]}
                          {REQUIRED_FIELDS.includes(f) ? " *" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 — preview and commit */}
      {preview && missingRequired.length === 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              3. Review and import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge
                variant="outline"
                className="border-positive/30 bg-positive/10 text-positive"
              >
                {preview.valid.length} ready
              </Badge>
              {preview.errors.length > 0 && (
                <Badge
                  variant="outline"
                  className="border-negative/30 bg-negative/10 text-negative"
                >
                  {preview.errors.length} skipped
                </Badge>
              )}
              <span className="text-muted-foreground">
                of {preview.totalRows} rows
              </span>
            </div>

            {preview.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/20 p-3">
                <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {preview.errors.slice(0, 50).map((e) => (
                    <li key={e.line}>
                      <span className="font-medium text-negative">
                        Row {e.line}
                      </span>{" "}
                      — {e.message}
                    </li>
                  ))}
                  {preview.errors.length > 50 && (
                    <li>…and {preview.errors.length - 50} more</li>
                  )}
                </ul>
              </div>
            )}

            {preview.valid.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Opened</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.valid.slice(0, 10).map((r) => (
                      <TableRow key={r.line}>
                        <TableCell className="font-medium">{r.symbol}</TableCell>
                        <TableCell className="uppercase text-muted-foreground">
                          {r.direction}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {r.quantity}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {new Date(r.openedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="capitalize text-muted-foreground">
                          {r.status}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono tabular-nums",
                            r.pnl === null
                              ? "text-muted-foreground"
                              : r.pnl > 0
                                ? "text-positive"
                                : r.pnl < 0
                                  ? "text-negative"
                                  : "text-muted-foreground",
                          )}
                        >
                          {r.pnl === null
                            ? "—"
                            : formatCurrency(r.pnl, { signed: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {preview.valid.length > 10 && (
                  <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                    Showing the first 10 of {preview.valid.length}.
                  </p>
                )}
              </div>
            )}

            <form action={formAction} className="flex flex-col gap-3">
              <input type="hidden" name="csv" value={csv} />
              <input
                type="hidden"
                name="mapping"
                value={JSON.stringify(mapping)}
              />
              <input
                type="hidden"
                name="hasHeader"
                value={String(hasHeader)}
              />
              <input type="hidden" name="accountId" value={accountId} />

              <div className="flex flex-col gap-2 sm:max-w-xs">
                <Label htmlFor="import-account">Import into</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger id="import-account">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {state.error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-foreground"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <span>{state.error}</span>
                </div>
              )}

              {state.message && (
                <div className="flex items-start gap-2 rounded-md border border-positive/30 bg-positive/10 p-3 text-xs text-positive">
                  <Check className="mt-0.5 size-4 shrink-0" />
                  <span>{state.message}</span>
                </div>
              )}

              <div>
                <SubmitButton count={preview.valid.length} />
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
