import { ClipboardList } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ReplayOrder } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS_TONE: Record<ReplayOrder["status"], string> = {
  pending: "border-primary/30 bg-primary/10 text-primary",
  filled: "border-positive/30 bg-positive/10 text-positive",
  cancelled: "border-border bg-muted/40 text-muted-foreground",
  expired: "border-border bg-muted/40 text-muted-foreground",
}

/**
 * Order history for a replay.
 *
 * Deliberately separate from the realised trade table: an order is an intent
 * that may never become a trade, and only filled orders produce one. Nothing
 * here feeds analytics.
 */
export function ReplayOrders({ orders }: { orders: ReplayOrder[] }) {
  if (orders.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={ClipboardList}
            title="No orders yet"
            description="Market orders fill immediately. Limit and stop orders rest here until the market reaches them."
            compact
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="p-0">
      <CardHeader className="pb-2 pt-6">
        <CardTitle className="text-sm font-semibold">Orders</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Requested</TableHead>
                <TableHead className="text-right">Filled</TableHead>
                <TableHead className="hidden text-right md:table-cell">SL</TableHead>
                <TableHead className="hidden text-right md:table-cell">TP</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium uppercase">
                    {order.orderType}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-xs font-medium uppercase tracking-wide",
                      order.direction === "long"
                        ? "text-positive"
                        : "text-negative",
                    )}
                  >
                    {order.direction}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {order.requestedPrice ?? (
                      <span className="text-muted-foreground">market</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {order.fillPrice ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono tabular-nums md:table-cell">
                    {order.stopPrice ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono tabular-nums md:table-cell">
                    {order.takeProfit ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">
                    {order.quantity}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn("capitalize", STATUS_TONE[order.status])}
                    >
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                    {new Date(order.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
