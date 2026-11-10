"use client";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

/**
 * Panneau latéral non bloquant (sans scrim sur grand écran) : entre et sort par la droite.
 * Sur mobile il devient une feuille glissée depuis le bas, qu'on peut rejeter d'un geste
 * (décision sur la vitesse de lâcher, pas sur la position).
 */
export function Sheet({ open, onClose, title, actions, children, width = 520 }: { open: boolean; onClose: () => void; title?: ReactNode; actions?: ReactNode; children: ReactNode; width?: number }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"][aria-modal="true"]')) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (typeof document === "undefined") return null;
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {isMobile && <motion.div className="fixed inset-0 z-[74] bg-[var(--scrim)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />}
          <motion.aside
            role="complementary"
            className={cn(
              "fixed z-[75] flex flex-col border-line bg-card shadow-[var(--shadow-lg)]",
              isMobile ? "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-[18px] border-t" : "top-2 right-2 bottom-2 rounded-[14px] border",
            )}
            style={isMobile ? undefined : { width: `min(${width}px, calc(100vw - 16px))` }}
            initial={reduce ? { opacity: 0 } : isMobile ? { y: "100%" } : { x: 40, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : isMobile ? { y: 0 } : { x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : isMobile ? { y: "100%" } : { x: 40, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}
            drag={isMobile ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.velocity.y > 400 || info.offset.y > 160) onClose();
            }}
          >
            {isMobile && <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line" />}
            <div className="flex shrink-0 items-center gap-2 border-b border-line-soft px-4 py-3">
              <div className="min-w-0 flex-1 truncate t-section">{title}</div>
              {actions}
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fermer">
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
