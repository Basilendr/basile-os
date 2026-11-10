"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type Toast = { id: number; kind: "success" | "error" | "info"; title: string; description?: string; action?: { label: string; run: () => void } };
type Ctx = { toast: (t: Omit<Toast, "id">) => void };

const ToastCtx = createContext<Ctx>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setItems((l) => [...l.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === "error" ? 7000 : 4000);
    },
    [dismiss],
  );
  const icon = { success: <CheckCircle2 className="size-4 text-success" />, error: <AlertCircle className="size-4 text-danger" />, info: <Info className="size-4 text-accent" /> };
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-20 z-[100] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 md:bottom-4">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
              transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}
              className="pointer-events-auto flex items-start gap-3 rounded-[11px] border border-line bg-card px-3.5 py-3 shadow-[var(--shadow-lg)]"
            >
              <span className="mt-0.5">{icon[t.kind]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{t.title}</p>
                {t.description && <p className="t-meta mt-0.5 break-words">{t.description}</p>}
                {t.action && (
                  <button className="mt-1.5 text-[12.5px] font-medium text-accent" onClick={() => (t.action!.run(), dismiss(t.id))}>
                    {t.action.label}
                  </button>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-fg-3 hover:text-fg" aria-label="Fermer">
                <X className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
