"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

export type MenuItem =
  | { type?: "item"; label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }
  | { type: "separator" }
  | { type: "label"; label: string };

/**
 * Menu contextuel ancré sur son déclencheur (transform-origin côté bouton),
 * navigation au clavier ↑ ↓ Entrée Échap.
 */
export function Menu({ trigger, items, align = "end", className }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; items: MenuItem[]; align?: "start" | "end"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; originY: "top" | "bottom" } | null>(null);
  const [active, setActive] = useState(-1);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const selectable = items.map((it, i) => ((!it.type || it.type === "item") && !("disabled" in it && it.disabled) ? i : -1)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const w = 220;
    const h = Math.min(items.length * 32 + 12, 400);
    const below = r.bottom + h + 8 < window.innerHeight;
    const left = align === "end" ? Math.max(8, r.right - w) : Math.min(r.left, window.innerWidth - w - 8);
    setPos({ top: below ? r.bottom + 6 : r.top - h - 6, left, originY: below ? "top" : "bottom" });
  }, [open, align, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = selectable.indexOf(active);
        const next = e.key === "ArrowDown" ? selectable[(idx + 1) % selectable.length] : selectable[(idx - 1 + selectable.length) % selectable.length];
        setActive(next ?? -1);
      }
      if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        const it = items[active];
        if (!it.type || it.type === "item") {
          setOpen(false);
          it.onSelect();
        }
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open, active, items, selectable]);

  return (
    <>
      <span ref={anchor} className="inline-flex" onClick={(e) => e.stopPropagation()}>
        {trigger({ open, toggle: () => (setActive(-1), setOpen((o) => !o)) })}
      </span>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                ref={panel}
                role="menu"
                className={cn("fixed z-[90] w-[220px] overflow-hidden rounded-[10px] border border-line bg-card p-1 shadow-[var(--shadow-lg)]", className)}
                style={{ top: pos.top, left: pos.left, transformOrigin: `${align === "end" ? "right" : "left"} ${pos.originY}` }}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ type: "spring", bounce: 0, visualDuration: 0.16 }}
                onClick={(e) => e.stopPropagation()}
              >
                {items.map((it, i) => {
                  if (it.type === "separator") return <div key={i} className="my-1 h-px bg-line-soft" />;
                  if (it.type === "label")
                    return (
                      <div key={i} className="t-label px-2 pt-1.5 pb-1">
                        {it.label}
                      </div>
                    );
                  return (
                    <button
                      key={i}
                      role="menuitem"
                      disabled={it.disabled}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => {
                        setOpen(false);
                        it.onSelect();
                      }}
                      className={cn(
                        "flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2 text-left text-[13px] disabled:opacity-40",
                        active === i && "bg-raised",
                        it.danger ? "text-danger" : "text-fg",
                      )}
                    >
                      {it.icon && <span className={cn("[&>svg]:size-3.5", it.danger ? "text-danger" : "text-fg-3")}>{it.icon}</span>}
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.hint && <span className="t-meta">{it.hint}</span>}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
