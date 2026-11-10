"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Maximize2, Plus, Lightbulb, X } from "lucide-react";
import { useUI } from "@/components/shell/ui-context";
import { Button } from "@/components/ui/button";
import { Composer, MessageList, useChat } from "./chat";
import { suggestionsFor } from "./suggestions";

/** Assistant disponible depuis tous les modules : panneau latéral non bloquant, contexte de la page ouverte. */
export function AssistantDrawer() {
  const { assistantOpen, setAssistantOpen, assistantSeed } = useUI();
  const pathname = usePathname();
  const [convId, setConvId] = useState<string | null>(null);
  const chat = useChat("assistant", convId, setConvId);
  const scroller = useRef<HTMLDivElement>(null);
  const sentSeed = useRef<string | null>(null);

  useEffect(() => {
    if (assistantOpen && assistantSeed && sentSeed.current !== assistantSeed) {
      sentSeed.current = assistantSeed;
      setConvId(null);
      setTimeout(() => chat.send(assistantSeed), 50);
    }
  }, [assistantOpen, assistantSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages]);

  useEffect(() => {
    if (!assistantOpen) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[role="dialog"][aria-modal="true"]') && setAssistantOpen(false);
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [assistantOpen, setAssistantOpen]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {assistantOpen && (
        <motion.aside
          aria-label="Assistant IA"
          className="fixed inset-0 z-[76] flex flex-col border-line bg-card shadow-[var(--shadow-lg)] md:inset-auto md:top-2 md:right-2 md:bottom-2 md:w-[440px] md:rounded-[16px] md:border"
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 32 }}
          transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}
        >
          <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
            <Lightbulb className="size-4 text-fg-3" />
            <span className="t-section flex-1">Assistant</span>
            <Button size="icon-sm" variant="ghost" onClick={() => setConvId(null)} aria-label="Nouvelle conversation" title="Nouvelle conversation">
              <Plus className="size-4" />
            </Button>
            <Link href={convId ? `/assistant?c=${convId}` : "/assistant"} onClick={() => setAssistantOpen(false)} className="grid size-7 place-items-center rounded-[7px] text-fg-3 hover:bg-raised hover:text-fg" aria-label="Ouvrir en plein écran">
              <Maximize2 className="size-3.5" />
            </Link>
            <Button size="icon-sm" variant="ghost" onClick={() => setAssistantOpen(false)} aria-label="Fermer">
              <X className="size-4" />
            </Button>
          </div>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {chat.messages.length === 0 ? (
              <div className="flex h-full flex-col justify-end gap-2">
                <p className="t-sub mb-1">Suggestions pour cette page</p>
                {suggestionsFor(pathname).map((s) => (
                  <button key={s} onClick={() => chat.send(s)} className="rounded-[10px] border border-line-soft bg-bg-2/60 px-3 py-2.5 text-left text-[13px] text-fg-2 transition-colors hover:border-line hover:text-fg">
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <MessageList messages={chat.messages} />
            )}
          </div>
          <div className="p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <Composer onSend={(t) => chat.send(t)} busy={chat.busy} onStop={chat.stop} autoFocus />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>,
    document.body,
  );
}
