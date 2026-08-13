import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: {
    default: "TRADAR — Professional Trading Journal & Analytics",
    template: "%s · TRADAR",
  },
  description:
    "TRADAR by TUNIZINA — a professional trading journal, performance analytics, and trade management platform for serious traders.",
  applicationName: "TRADAR",
  keywords: [
    "trading journal",
    "trade analytics",
    "trading performance",
    "backtesting",
    "TRADAR",
    "TUNIZINA",
  ],
  authors: [{ name: "TUNIZINA" }],
  metadataBase: new URL("https://tradar.tunizina.net"),
}

export const viewport: Viewport = {
  themeColor: "#0a0e14",
  colorScheme: "dark",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`dark bg-background ${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
