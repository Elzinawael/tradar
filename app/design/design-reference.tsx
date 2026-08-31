"use client"

import { useState } from "react"
import { Bell, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { FormFeedback } from "@/components/ui/form-feedback"
import { Input } from "@/components/ui/input"
import { SearchInput } from "@/components/ui/search-input"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Skeleton } from "@/components/ui/skeleton"
import { Stat, StatGrid } from "@/components/ui/stat"
import { Textarea } from "@/components/ui/textarea"

const SURFACE_TOKENS = [
  "--background",
  "--card",
  "--popover",
  "--muted",
  "--secondary",
  "--accent",
  "--sidebar",
  "--border",
] as const

const STATUS_TOKENS = [
  "--primary",
  "--positive",
  "--negative",
  "--warning",
  "--info",
  "--destructive",
  "--neutral",
] as const

const TEXT_TOKENS = ["--foreground", "--muted-foreground", "--text-tertiary"] as const

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="size-10 shrink-0 rounded-md border border-border"
        style={{ background: `var(${token})` }}
      />
      <code className="text-xs text-muted-foreground">{token}</code>
    </div>
  )
}

export function DesignReference() {
  const [timeframe, setTimeframe] = useState("H1")
  const [side, setSide] = useState("long")

  return (
    <div className="mx-auto max-w-5xl space-y-12 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          TRADAR design reference
        </h1>
        <p className="text-sm text-muted-foreground">
          Development-only. Tokens, scales and shared primitives introduced in
          Phase 1. Not a real route in production.
        </p>
      </header>

      <Section title="Surfaces & borders">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SURFACE_TOKENS.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </div>
      </Section>

      <Section title="Status colors">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STATUS_TOKENS.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </div>
      </Section>

      <Section title="Text hierarchy">
        <div className="space-y-2">
          {TEXT_TOKENS.map((token) => (
            <p key={token} style={{ color: `var(${token})` }} className="text-sm">
              {token} — The quick brown fox jumps over the lazy dog
            </p>
          ))}
          <p className="label-eyebrow">.label-eyebrow — section label</p>
          <p className="text-2xs text-muted-foreground">
            .text-2xs — 11px supporting text
          </p>
        </div>
      </Section>

      <Section title="Typography scale">
        <div className="space-y-1">
          <p className="text-3xl font-semibold tracking-tight">text-3xl</p>
          <p className="text-2xl font-semibold tracking-tight">text-2xl</p>
          <p className="text-xl font-semibold tracking-tight">text-xl</p>
          <p className="text-lg font-semibold">text-lg</p>
          <p className="text-base">text-base</p>
          <p className="text-sm">text-sm — body default</p>
          <p className="text-xs">text-xs — 12px</p>
          <p className="text-2xs">text-2xs — 11px</p>
        </div>
      </Section>

      <Section title="Radius">
        <div className="flex flex-wrap gap-4">
          {(["rounded-sm", "rounded-md", "rounded-lg", "rounded-full"] as const).map(
            (radius) => (
              <div key={radius} className="flex flex-col items-center gap-2">
                <div
                  className={`size-16 border border-border bg-card ${radius}`}
                />
                <code className="text-xs text-muted-foreground">{radius}</code>
              </div>
            ),
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Cards and dialogs use <code>rounded-lg</code>; controls (button,
          input, select, badge) use <code>rounded-md</code>.
        </p>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs">xs</Button>
          <Button size="sm">sm</Button>
          <Button size="default">default</Button>
          <Button size="lg">lg</Button>
          <Button size="icon" aria-label="Icon button">
            <Bell />
          </Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>default</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="outline">outline</Badge>
          <Badge variant="positive">positive</Badge>
          <Badge variant="negative">negative</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="info">info</Badge>
          <Badge variant="neutral">neutral</Badge>
        </div>
      </Section>

      <Section title="Inputs & fields">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Normal field" htmlFor="d-normal" hint="A short hint.">
            <Input id="d-normal" placeholder="Type here" />
          </Field>
          <Field
            label="Invalid field"
            htmlFor="d-invalid"
            error="This value is required."
          >
            <Input id="d-invalid" aria-invalid placeholder="Type here" />
          </Field>
          <Field label="Textarea" htmlFor="d-textarea">
            <Textarea id="d-textarea" rows={3} placeholder="Notes" />
          </Field>
          <Field label="Search" htmlFor="d-search">
            <SearchInput id="d-search" placeholder="Search instruments…" />
          </Field>
        </div>
      </Section>

      <Section title="Segmented control">
        <div className="flex flex-wrap gap-4">
          <SegmentedControl
            aria-label="Timeframe"
            value={timeframe}
            onValueChange={setTimeframe}
            options={[
              { value: "M15", label: "M15" },
              { value: "H1", label: "H1" },
              { value: "H4", label: "H4" },
              { value: "D1", label: "D1" },
            ]}
          />
          <SegmentedControl
            aria-label="Side"
            size="sm"
            value={side}
            onValueChange={setSide}
            options={[
              { value: "long", label: "Long" },
              { value: "short", label: "Short" },
            ]}
          />
        </div>
      </Section>

      <Section title="Stat grid">
        <Card>
          <CardContent className="pt-6">
            <StatGrid columns={5}>
              <Stat label="Entry" value="1.23451" />
              <Stat label="Net P&L" value="+$1,240.00" tone="positive" />
              <Stat label="Drawdown" value="-$320.00" tone="negative" />
              <Stat label="Win rate" value="58.3%" hint="24 closed" />
              <Stat label="R multiple" value="+1.84R" tone="primary" />
            </StatGrid>
          </CardContent>
        </Card>
      </Section>

      <Section title="Cards">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Static card</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Default surface, <code>rounded-lg</code>.
            </CardContent>
          </Card>
          <Card interactive>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Interactive card
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Hover for the border affordance (<code>interactive</code> prop).
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Form feedback">
        <div className="space-y-3">
          <FormFeedback error="Something went wrong. Try again." />
          <FormFeedback message="Saved. Your changes are live." />
        </div>
      </Section>

      <Section title="Skeleton">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Section>

      <Section title="Icon sizing">
        <div className="flex items-center gap-4 text-muted-foreground">
          <Search className="size-3" />
          <Search className="size-3.5" />
          <Search className="size-4" />
          <Search className="size-5" />
          <span className="text-xs">
            Default in-component icon size is <code>size-4</code>.
          </span>
        </div>
      </Section>
    </div>
  )
}
