"use client";
import { useCallback } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "./api";

/**
 * Données principales de chaque page, chargées dès que la souris passe sur son lien dans le menu :
 * au clic, la page s'affiche déjà remplie. Les clés doivent être exactement celles des pages.
 */
const PAGES: Record<string, { key: QueryKey; url: string }[]> = {
  "/definitions": [{ key: ["defs"], url: "/api/definitions" }],
  "/vocabulaire": [{ key: ["vocab"], url: "/api/flashcards" }],
  "/quiz": [{ key: ["quiz", "overview"], url: "/api/quiz" }],
  "/today": [{ key: ["today"], url: "/api/today" }],
  "/inbox": [
    { key: ["school", "summary"], url: "/api/school/summary" },
    { key: ["mail", "account"], url: "/api/mail/account" },
  ],
  "/brain": [{ key: ["brain-graph"], url: "/api/brain/graph" }],
  "/automations": [{ key: ["automations"], url: "/api/automations" }],
};

/** Gestionnaire à brancher sur onMouseEnter / onFocus / onTouchStart d'un lien du menu. */
export function usePrefetchPage() {
  const qc = useQueryClient();
  return useCallback(
    (href: string) => {
      const list = PAGES[href.split("?")[0]];
      if (!list) return;
      // Données encore fraîches (moins de 20 s) : rien n'est redemandé au serveur.
      for (const p of list) qc.prefetchQuery({ queryKey: p.key, queryFn: () => api.get(p.url), staleTime: 20_000 }).catch(() => {});
    },
    [qc],
  );
}
