import Link from "next/link"
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  FlaskConical,
  History,
  ShieldCheck,
  Target,
} from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const features = [
  {
    icon: BarChart3,
    title: "Performance Analytics",
    description:
      "Net P&L, profit factor, expectancy, drawdown and dozens of metrics — computed from your real trade history.",
  },
  {
    icon: BookOpen,
    title: "Structured Journaling",
    description:
      "Pre-market plans, session notes and post-market reviews keep your decisions accountable every day.",
  },
  {
    icon: Target,
    title: "Strategy Playbooks",
    description:
      "Define entry, exit and risk rules, then measure how each strategy actually performs over time.",
  },
  {
    icon: History,
    title: "Trade Replay",
    description:
      "Step back through your executions on the chart to understand exactly how each trade unfolded.",
  },
  {
    icon: FlaskConical,
    title: "Backtesting Workspace",
    description:
      "Simulate strategies against defined parameters and record results in a dedicated environment.",
  },
  {
    icon: ShieldCheck,
    title: "Discipline Tracking",
    description:
      "Turn your trading rules into daily checklists and build consistency with streaks and goals.",
  },
]

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 md:px-6">
          <BrandLogo />
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent)]"
          />
          <div className="relative mx-auto w-full max-w-6xl px-4 py-20 text-center md:px-6 md:py-28">
            <Badge variant="outline" className="mx-auto mb-6 gap-2 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Professional Trading Journal &amp; Analytics
            </Badge>
            <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-6xl">
              Trade with a{" "}
              <span className="text-primary">clear edge</span>, not a gut feeling.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-base text-muted-foreground md:text-lg">
              TRADAR helps active traders record every trade, analyze performance,
              journal decisions and refine strategy — so improvement becomes a
              measurable process instead of a guess.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">
                  Start your journal
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/dashboard">Explore the platform</Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              No fake data. Your analytics unlock the moment you import real trades.
            </p>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
              Everything a serious trader needs in one workspace
            </h2>
            <p className="mt-3 text-pretty text-muted-foreground">
              A restrained, information-dense platform built for review and
              consistency — not dashboards for their own sake.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
              >
                <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                  <feature.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6 md:py-20">
            <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card px-6 py-12 text-center">
              <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
                Build the discipline that compounds.
              </h2>
              <p className="max-w-xl text-pretty text-muted-foreground">
                Set up your account and start journaling today. TRADAR grows with
                your trading practice.
              </p>
              <Button asChild size="lg">
                <Link href="/signup">
                  Create your account
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground md:flex-row md:px-6">
          <BrandLogo size={28} />
          <p>© {new Date().getFullYear()} TRADAR by TUNIZINA. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
