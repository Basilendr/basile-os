"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, ChevronRight, Home, Inbox } from "lucide-react";
import { FOLDERS, isActive } from "@/components/shell/nav";
import { cn, initials } from "@/lib/utils";
import { Button } from "./button";

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("surface", className)} {...p}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action, subtitle, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="text-fg-3">{icon}</span>}
        <div className="min-w-0">
          <h3 className="t-section truncate">{title}</h3>
          {subtitle && <p className="t-meta truncate">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

const TONES = {
  neutral: "bg-raised text-fg-2 border-line",
  accent: "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent border-[color-mix(in_srgb,var(--accent)_25%,transparent)]",
  success: "bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success border-[color-mix(in_srgb,var(--success)_22%,transparent)]",
  warning: "bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-warning border-[color-mix(in_srgb,var(--warning)_22%,transparent)]",
  danger: "bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger border-[color-mix(in_srgb,var(--danger)_22%,transparent)]",
  violet: "bg-[color-mix(in_srgb,var(--accent-2)_14%,transparent)] text-fg-3 border-[color-mix(in_srgb,var(--accent-2)_25%,transparent)]",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-[5px] border px-1.5 text-[11px] font-medium whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line bg-bg-2 px-1 font-sans text-[10.5px] font-medium text-fg-3">
      {children}
    </kbd>
  );
}

export function Avatar({ name, src, size = 28, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-raised font-semibold text-fg-2 ring-1 ring-line", className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials(name) || "?"}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 text-center", /(^|\s)(py|pt|pb|p)-/.test(className ?? "") ? null : "py-12", className)}>
      <div className="mb-3 grid size-11 place-items-center rounded-[12px] bg-raised text-fg-3">{icon ?? <Inbox className="size-5" />}</div>
      <p className="t-section">{title}</p>
      {description && <p className="t-sub mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const message = error instanceof Error ? error.message : "Une erreur est survenue";
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <AlertTriangle className="size-5 text-danger" />
      <p className="text-[13px] text-fg-2">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

/** En-tête de page : fil d'Ariane (accueil › dossier › page), titre, description, actions à droite. */
export function PageHeader({ title, description, actions, children, crumbs }: { title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode; crumbs?: { label: string; href?: string }[] }) {
  const pathname = usePathname();
  const folder = FOLDERS.find((f) => f.items.some((i) => isActive(pathname, i.href)));
  const trail = crumbs ?? (folder && folder.label !== title ? [{ label: folder.label }] : []);
  return (
    <div className="mb-4 flex flex-col gap-3 md:mb-5">
      {/* Sur téléphone, la barre d'onglets suffit : pas de fil d'Ariane. */}
      <nav className="hidden items-center gap-1.5 text-[12.5px] text-fg-3 md:flex" aria-label="Fil d'Ariane">
        <Link href="/" className="hover:text-fg" aria-label="Accueil">
          <Home className="size-3.5" />
        </Link>
        {trail.map((c) => (
          <span key={c.label} className="flex items-center gap-1.5">
            <ChevronRight className="size-3" />
            {c.href ? (
              <Link href={c.href} className="hover:text-fg">
                {c.label}
              </Link>
            ) : (
              c.label
            )}
          </span>
        ))}
        <ChevronRight className="size-3" />
        <span className="font-medium text-fg-2">{title}</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-title">{title}</h1>
          {description && <p className="t-sub mt-1">{description}</p>}
        </div>
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Progress({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-raised", className)}>
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color ?? "var(--accent)" }}
      />
    </div>
  );
}
