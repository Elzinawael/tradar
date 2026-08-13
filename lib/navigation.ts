import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Database,
  Download,
  FileText,
  FlaskConical,
  Gauge,
  History,
  LayoutDashboard,
  ListChecks,
  Play,
  Settings,
  Target,
  Upload,
  User,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    title: "Tracking",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Day View", href: "/day-view", icon: CalendarDays },
      { label: "Trades", href: "/trades", icon: ListChecks },
      { label: "Journal", href: "/journal", icon: BookOpen },
      { label: "Reports", href: "/reports", icon: BarChart3 },
      { label: "Strategies", href: "/strategies", icon: Target },
      { label: "Trade Replay", href: "/replay", icon: History },
      { label: "Progress", href: "/progress", icon: Gauge },
    ],
  },
  {
    title: "Backtesting",
    items: [
      { label: "Backtesting Dashboard", href: "/backtesting", icon: FlaskConical },
      { label: "Backtest Sessions", href: "/backtesting/sessions", icon: Play },
    ],
  },
  {
    title: "Tools",
    items: [
      { label: "Import Trades", href: "/import", icon: Upload },
      { label: "Export Data", href: "/settings?tab=data", icon: Download },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Profile", href: "/settings?tab=profile", icon: User },
    ],
  },
]

export const iconMap = {
  FileText,
  Database,
} as const
