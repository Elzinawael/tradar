import { cn } from "@/lib/utils"

interface BrandLogoProps {
  className?: string
  showWordmark?: boolean
  size?: number
}

/**
 * TRADAR brand mark — a stylized radar sweep in the TUNIZINA gold, referencing
 * "radar" for market awareness. Independent identity; no third-party assets.
 */
export function BrandLogo({
  className,
  showWordmark = true,
  size = 32,
}: BrandLogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className="relative grid shrink-0 place-items-center rounded-lg bg-primary/10 ring-1 ring-primary/25"
        style={{ width: size, height: size }}
      >
        <svg
          width={size * 0.62}
          height={size * 0.62}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="var(--primary)" strokeWidth="1.5" opacity="0.35" />
          <circle cx="12" cy="12" r="5" stroke="var(--primary)" strokeWidth="1.5" opacity="0.55" />
          <path
            d="M12 12 L12 3 A9 9 0 0 1 20 9 Z"
            fill="var(--primary)"
            opacity="0.9"
          />
          <circle cx="12" cy="12" r="1.6" fill="var(--primary)" />
        </svg>
      </span>
      {showWordmark && (
        <span className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-[0.18em] text-foreground">
            TRADAR
          </span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            by TUNIZINA
          </span>
        </span>
      )}
    </div>
  )
}
