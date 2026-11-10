"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronRight, LogOut, Settings } from "lucide-react";
import { FOLDERS, SHORTCUTS, TONES, activeHref, folderOf, type NavFolder, type NavLeaf } from "./nav";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

const SPRING = { type: "spring", bounce: 0, visualDuration: 0.28 } as const;

/** Dossier dessiné (dos + façade), teinté par la couleur du dossier ; la façade s'abaisse quand il est ouvert. */
export function FolderGlyph({ tone, open, size = 30 }: { tone: NavFolder["tone"]; open?: boolean; size?: number }) {
  const t = TONES[tone];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <path d="M4 9.5A2.5 2.5 0 0 1 6.5 7h6.1c.7 0 1.3.3 1.8.8l1.6 1.7h9.5A2.5 2.5 0 0 1 28 12v12.5a2.5 2.5 0 0 1-2.5 2.5h-19A2.5 2.5 0 0 1 4 24.5v-15Z" fill={t.fg} opacity={0.55} />
      <motion.path
        d="M4 13.2A2.2 2.2 0 0 1 6.2 11h19.6a2.2 2.2 0 0 1 2.2 2.2v11.3a2.5 2.5 0 0 1-2.5 2.5h-19A2.5 2.5 0 0 1 4 24.5V13.2Z"
        fill={t.fg}
        style={{ transformOrigin: "16px 27px" }}
        initial={false}
        animate={{ scaleY: open ? 0.78 : 1, skewX: open ? -8 : 0 }}
        transition={SPRING}
      />
      <path d="M7 14.5h18" stroke="white" strokeOpacity={0.35} strokeWidth={1.2} strokeLinecap="round" />
    </svg>
  );
}

/** Navigation : trois accès directs, puis quatre dossiers qui s'ouvrent sur leurs fonctionnalités. */
export function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const active = activeHref(pathname, search);
  const activeFolder = folderOf(active);
  const [openId, setOpenId] = useState<string | null>(activeFolder?.id ?? null);
  useEffect(() => {
    if (activeFolder) setOpenId(activeFolder.id);
  }, [activeFolder]);

  return (
    <div className="flex h-full flex-col">
      <nav className={cn("min-h-0 flex-1 overflow-y-auto pt-3 pb-2", collapsed ? "px-2" : "px-3")} aria-label="Navigation principale">
        <ul className="flex flex-col gap-0.5">
          {SHORTCUTS.map((s) => (
            <li key={s.href}>
              <Shortcut leaf={s} active={active === s.href} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        {collapsed ? <div className="mx-3 my-3 h-px bg-line-soft" /> : <p className="t-label px-3 pt-5 pb-2">Dossiers</p>}
        <ul className="flex flex-col gap-1">
          {FOLDERS.map((f) =>
            collapsed ? (
              <li key={f.id}>
                <RailFolder folder={f} active={active} highlighted={activeFolder?.id === f.id} onNavigate={onNavigate} />
              </li>
            ) : (
              <li key={f.id}>
                <Folder folder={f} open={openId === f.id} highlighted={activeFolder?.id === f.id} active={active} onToggle={() => setOpenId((o) => (o === f.id ? null : f.id))} onNavigate={onNavigate} />
              </li>
            ),
          )}
        </ul>
      </nav>
      <div className={cn("shrink-0 border-t border-line-soft py-2.5", collapsed ? "px-2" : "px-3")}>
        <Shortcut leaf={{ href: "/settings", label: "Paramètres", icon: Settings }} active={active === "/settings" || active === "/integrations"} collapsed={collapsed} onNavigate={onNavigate} />
        <button
          onClick={async () => {
            await api.post("/api/auth/logout").catch(() => null);
            window.location.href = "/login";
          }}
          title={collapsed ? "Déconnexion" : undefined}
          className={cn("focus-ring flex h-9 w-full items-center gap-3 rounded-[11px] text-[13.5px] text-fg-2 transition-colors hover:bg-raised/70 hover:text-fg", collapsed ? "justify-center" : "px-3")}
        >
          <LogOut className="size-[17px] text-fg-3" strokeWidth={1.75} />
          {!collapsed && "Déconnexion"}
        </button>
      </div>
    </div>
  );
}

function Shortcut({ leaf, active, collapsed, onNavigate }: { leaf: NavLeaf; active: boolean; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = leaf.icon;
  return (
    <Link
      href={leaf.href}
      onClick={onNavigate}
      title={collapsed ? leaf.label : undefined}
      aria-label={collapsed ? leaf.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring group relative flex h-10 items-center gap-3 rounded-[12px] text-[14px] transition-colors duration-100",
        collapsed ? "justify-center" : "px-3",
        active ? "font-medium text-fg" : "text-fg-2 hover:bg-raised/70 hover:text-fg",
      )}
    >
      {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-[12px] bg-raised shadow-[inset_0_0_0_1px_var(--line-soft)]" transition={SPRING} />}
      <Icon className={cn("relative size-[18px] shrink-0", active ? "text-fg" : "text-fg-3 group-hover:text-fg-2")} strokeWidth={1.75} />
      {!collapsed && <span className="relative truncate">{leaf.label}</span>}
    </Link>
  );
}

/** Dossier dépliable : l'en-tête montre ce qu'il contient, l'ouverture révèle des tuiles comme un dossier d'apps. */
function Folder({ folder, open, highlighted, active, onToggle, onNavigate }: { folder: NavFolder; open: boolean; highlighted: boolean; active: string | null; onToggle: () => void; onNavigate?: () => void }) {
  const t = TONES[folder.tone];
  const reduce = useReducedMotion();
  return (
    <div className={cn("rounded-[16px] transition-colors duration-200", open && "bg-[var(--folder-bg)]")} style={{ "--folder-bg": t.soft } as React.CSSProperties}>
      <button onClick={onToggle} aria-expanded={open} className={cn("focus-ring group flex w-full items-center gap-3 rounded-[14px] px-2 py-1.5 text-left transition-colors", !open && "hover:bg-raised/70")}>
        <span className="grid size-9 place-items-center">
          <FolderGlyph tone={folder.tone} open={open} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[14px] leading-tight", open || highlighted ? "font-semibold text-fg" : "font-medium text-fg-2 group-hover:text-fg")}>{folder.label}</span>
          <span className="block truncate text-[11.5px] leading-tight text-fg-3">{open ? `${folder.items.length} fonctionnalités` : folder.hint}</span>
        </span>
        <ChevronRight className={cn("size-4 shrink-0 text-fg-3 transition-transform duration-200", open && "rotate-90")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={SPRING}
            className="overflow-hidden"
          >
            <Tiles folder={folder} active={active} onNavigate={onNavigate} className="px-1.5 pt-0.5 pb-1.5" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Tiles({ folder, active, onNavigate, className }: { folder: NavFolder; active: string | null; onNavigate?: () => void; className?: string }) {
  const t = TONES[folder.tone];
  return (
    <ul className={cn("grid grid-cols-2 gap-1.5", className)}>
      {folder.items.map((it) => {
        const Icon = it.icon;
        const on = active === it.href;
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              onClick={onNavigate}
              aria-current={on ? "page" : undefined}
              className={cn(
                "focus-ring group flex h-[62px] flex-col justify-between rounded-[12px] border p-2.5 transition-[background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.97]",
                on ? "border-transparent bg-card shadow-[var(--shadow-md)] ring-1" : "border-transparent bg-card/55 hover:bg-card hover:shadow-[var(--shadow-sm)]",
              )}
              style={on ? ({ "--tw-ring-color": t.strong } as React.CSSProperties) : undefined}
            >
              <Icon className="size-[17px]" style={{ color: t.fg }} strokeWidth={2} />
              <span className={cn("line-clamp-2 text-[12.5px] leading-[1.15]", on ? "font-semibold text-fg" : "font-medium text-fg-2 group-hover:text-fg")}>{it.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Barre réduite : le dossier s'ouvre en panneau flottant à droite de la barre. */
function RailFolder({ folder, active, highlighted, onNavigate }: { folder: NavFolder; active: string | null; highlighted: boolean; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const t = TONES[folder.tone];
  useEffect(() => setOpen(false), [pathname]);
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos({ top: Math.min(r.top - 8, window.innerHeight - 220), left: r.right + 12 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={folder.label}
        title={folder.label}
        className={cn("focus-ring grid h-11 w-full place-items-center rounded-[12px] transition-colors", open || highlighted ? "bg-[var(--folder-bg)]" : "hover:bg-raised/70")}
        style={{ "--folder-bg": t.soft } as React.CSSProperties}
      >
        <FolderGlyph tone={folder.tone} open={open} size={28} />
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                ref={panel}
                role="dialog"
                aria-label={folder.label}
                initial={{ opacity: 0, scale: 0.94, x: -6 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.96, x: -4 }}
                transition={SPRING}
                className="fixed z-[80] w-[264px] origin-left rounded-[18px] border border-line bg-card p-3 shadow-[var(--shadow-lg)]"
                style={{ top: pos.top, left: pos.left }}
              >
                <div className="mb-2.5 flex items-center gap-2.5 px-1">
                  <FolderGlyph tone={folder.tone} open size={26} />
                  <div className="min-w-0">
                    <p className="text-[14px] leading-tight font-semibold">{folder.label}</p>
                    <p className="truncate text-[11.5px] text-fg-3">{folder.hint}</p>
                  </div>
                </div>
                <div className="rounded-[14px] p-1.5" style={{ background: t.soft }}>
                  <Tiles folder={folder} active={active} onNavigate={() => (setOpen(false), onNavigate?.())} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
