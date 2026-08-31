import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Database,
  FlaskConical,
  Gauge,
  History,
  LayoutDashboard,
  ListChecks,
  Play,
  Settings,
  Target,
  Upload,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  /**
   * Shown in the mobile bottom bar. Every other destination is still reachable
   * there through the "Menu" button, which opens the full navigation drawer.
   */
  primary?: boolean
}

export interface NavSection {
  /**
   * Omitted for the trailing utility group, which renders as a plain divided
   * block rather than a titled section.
   */
  title?: string
  items: NavItem[]
}

/**
 * The single source of truth for primary navigation. The desktop sidebar, the
 * mobile drawer and the mobile bottom bar all derive from this — there is no
 * second hardcoded list.
 */
export const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, primary: true },
      { label: "Day View", href: "/day-view", icon: CalendarDays },
    ],
  },
  {
    title: "Journal",
    items: [
      { label: "Trades", href: "/trades", icon: ListChecks, primary: true },
      { label: "Journal", href: "/journal", icon: BookOpen, primary: true },
      { label: "Progress", href: "/progress", icon: Gauge },
      { label: "Reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    title: "Markets",
    items: [
      // Instrument catalogue + data status, currently served at /replay/data.
      { label: "Markets", href: "/replay/data", icon: Database },
      { label: "Replay", href: "/replay", icon: History, primary: true },
    ],
  },
  {
    title: "Research",
    items: [
      { label: "Backtesting", href: "/backtesting", icon: FlaskConical },
      { label: "Sessions", href: "/backtesting/sessions", icon: Play },
      { label: "Strategies", href: "/strategies", icon: Target },
    ],
  },
  {
    items: [
      { label: "Import", href: "/import", icon: Upload },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
]

/** Every nav item, flattened — for active-route resolution. */
export const navItems: NavItem[] = navSections.flatMap((section) => section.items)

/** Destinations shown in the mobile bottom bar. */
export const primaryNavItems: NavItem[] = navItems.filter((item) => item.primary)

/**
 * The href of the nav item that best matches `pathname`: an exact match, or the
 * longest item href that is a path prefix.
 *
 * "Longest prefix wins" is what lets "Markets" (`/replay/data`) beat "Replay"
 * (`/replay`) on the market-data page, and a detail route like
 * `/backtesting/sessions/42` resolve to "Sessions" rather than "Backtesting".
 * The query string is ignored, so `/settings?tab=profile` still matches
 * "Settings".
 */
export function activeNavHref(pathname: string): string | null {
  // usePathname() never includes a query string, but strip one defensively.
  const path = pathname.split("?")[0]
  let match: string | null = null
  let matchLength = -1
  for (const item of navItems) {
    const base = item.href.split("?")[0]
    const isMatch = path === base || path.startsWith(`${base}/`)
    if (isMatch && base.length > matchLength) {
      match = item.href
      matchLength = base.length
    }
  }
  return match
}

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

export interface Crumb {
  label: string
  href?: string
}

/** Static path → label, for the linked ancestors of a breadcrumb trail. */
const SEGMENT_LABELS: Record<string, string> = {
  "/backtesting": "Backtesting",
  "/backtesting/sessions": "Sessions",
  "/trades": "Trades",
  "/replay": "Replay",
  "/strategies": "Strategies",
  "/journal": "Journal",
}

/**
 * Builds a breadcrumb trail: the linked ancestors resolved from
 * {@link SEGMENT_LABELS} for `basePath`, followed by the `tail` crumbs the page
 * supplies (the dynamic ones it alone can name). Only deep routes should call
 * this; top-level pages omit breadcrumbs entirely.
 *
 *   breadcrumbTrail("/backtesting/sessions", { label: session.name })
 *   // → Backtesting › Sessions › {session.name}
 */
export function breadcrumbTrail(basePath: string, ...tail: Crumb[]): Crumb[] {
  const crumbs: Crumb[] = []
  let acc = ""
  for (const segment of basePath.split("/").filter(Boolean)) {
    acc += `/${segment}`
    const label = SEGMENT_LABELS[acc]
    if (label) crumbs.push({ label, href: acc })
  }
  return [...crumbs, ...tail]
}
