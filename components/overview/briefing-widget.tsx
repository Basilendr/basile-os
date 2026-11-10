"use client";
import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Lightbulb, RefreshCw, Link2, ExternalLink } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { WidgetCard } from "./widgets";
import { Markdown } from "@/components/assistant/markdown";
import { useToast } from "@/components/ui/toast";
import { useStatus } from "@/hooks/use-status";
import { relativeTime } from "@/lib/utils";
import type { DashboardData } from "./overview";

export function BriefingWidget({ briefing }: { briefing: DashboardData["briefing"] }) {
  const { data: status } = useStatus();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      await api.post("/api/ai/briefing", { kind: new Date().getHours() >= 17 ? "evening" : "morning" });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast({ kind: "error", title: "Briefing non généré", description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const aiOk = status?.ai.configured;
  return (
    <WidgetCard
      title={new Date().getHours() >= 17 ? "Bilan de la journée" : "Briefing du jour"}
      subtitle={briefing ? `Généré ${relativeTime(briefing.createdAt)}` : "Synthèse de tes données par l'IA"}
      action={
        briefing && (
          <Button size="icon-sm" variant="ghost" onClick={generate} disabled={loading || !aiOk} aria-label="Actualiser le briefing">
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
          </Button>
        )
      }
    >
      <div>
        {!briefing ? (
          <EmptyState
            className="py-2"
            icon={<Lightbulb className="size-5" />}
            title={aiOk ? "Aucun briefing aujourd'hui" : "Assistant non configuré"}
            description={
              aiOk ? (
                "Le briefing s'appuie uniquement sur tes données réelles et cite ses sources."
              ) : (
                <>
                  Ajoute ta clé IA pour activer le briefing.{" "}
                  <Link href="/settings?s=config" className="text-accent underline-offset-2 hover:underline">
                    Configurer
                  </Link>
                </>
              )
            }
            action={
              aiOk && (
                <Button variant="primary" size="sm" loading={loading} icon={<Lightbulb className="size-3.5" />} onClick={generate}>
                  Générer le briefing
                </Button>
              )
            }
          />
        ) : (
          <>
            <Markdown content={briefing.content} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" icon={<Link2 className="size-3.5" />} onClick={() => setShowSources((s) => !s)}>
                Sources ({briefing.sources.length})
              </Button>
            </div>
            <AnimatePresence>
              {showSources && (
                <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-2 overflow-hidden">
                  {briefing.sources.length === 0 && <li className="t-meta px-2 py-1">Aucune source : aucune donnée disponible.</li>}
                  {briefing.sources.map((s) => (
                    <li key={`${s.type}-${s.id}`}>
                      <Link href={s.href} className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-[12.5px] text-fg-2 hover:bg-raised hover:text-fg">
                        <ExternalLink className="size-3 shrink-0 text-fg-3" />
                        <span className="t-label w-16 shrink-0">{s.type}</span>
                        <span className="truncate">{s.title}</span>
                      </Link>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </WidgetCard>
  );
}
