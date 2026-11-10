"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CalendarPlus, CheckSquare, Clock, FilePlus2, FolderPlus, Mail, MessageSquare, NotebookPen, Play, Search, Lightbulb, Upload, Workflow, CalendarDays, FolderKanban, FileText, User, BrainCircuit, Inbox } from "lucide-react";
import { NAV, SECONDARY } from "./nav";
import { useUI, type CreateKind } from "./ui-context";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";

type Item = { id: string; group: string; label: string; hint?: string; icon: ReactNode; run: () => void; keywords?: string };

type Hit = { type: string; id: string; title: string; subtitle?: string; href: string };

const HIT_ICONS: Record<string, ReactNode> = {
  task: <CheckSquare />,
  project: <FolderKanban />,
  note: <NotebookPen />,
  contact: <User />,
  event: <CalendarDays />,
  email: <Mail />,
  file: <FileText />,
  conversation: <MessageSquare />,
  knowledge: <BrainCircuit />,
};
const HIT_LABELS: Record<string, string> = {
  task: "Tâches",
  project: "Projets",
  note: "Notes",
  contact: "Contacts",
  event: "Événements",
  email: "Emails",
  file: "Fichiers",
  conversation: "Conversations IA",
  knowledge: "Second Brain",
};

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function CommandPalette() {
  const { paletteOpen, closePalette, paletteQuery, openCreate, askAssistant, setAssistantOpen } = useUI();
  const router = useRouter();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const dq = useDebounced(q, 120);

  useEffect(() => {
    if (paletteOpen) {
      setQ(paletteQuery);
      setActive(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [paletteOpen, paletteQuery]);

  const { data: search, isFetching } = useQuery({
    queryKey: ["palette-search", dq],
    queryFn: () => api.get<{ hits: Hit[] }>(`/api/search?q=${encodeURIComponent(dq)}&limit=4&remember=1`),
    enabled: paletteOpen && dq.trim().length > 1,
    staleTime: 10_000,
  });
  const { data: prefs } = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.get<{ recentSearches: string[] }>("/api/preferences"),
    enabled: paletteOpen,
  });
  const { data: automations } = useQuery({
    queryKey: ["automations"],
    queryFn: () => api.get<{ items: { id: string; name: string; enabled: boolean }[] }>("/api/automations"),
    enabled: paletteOpen,
    retry: false,
  });

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => (router.push(href), closePalette());
    const create = (k: CreateKind) => () => (closePalette(), openCreate(k));
    const base: Item[] = [
      { id: "c-task", group: "Créer", label: "Nouvelle tâche", icon: <CheckSquare />, run: create("task"), hint: "T", keywords: "task todo ajouter" },
      { id: "c-event", group: "Créer", label: "Nouvel événement", icon: <CalendarPlus />, run: create("event"), keywords: "rendez-vous meeting agenda" },
      { id: "c-note", group: "Créer", label: "Nouvelle note", icon: <NotebookPen />, run: create("note"), keywords: "écrire idée" },
      { id: "c-project", group: "Créer", label: "Nouveau projet", icon: <FolderPlus />, run: create("project") },
      { id: "c-email", group: "Créer", label: "Rédiger un email", icon: <Mail />, run: go("/inbox?compose=1"), keywords: "gmail envoyer message" },
      { id: "c-auto", group: "Créer", label: "Nouvelle automatisation", icon: <Workflow />, run: go("/automations?new=1") },
      { id: "c-file", group: "Créer", label: "Importer un fichier", icon: <Upload />, run: go("/files?upload=1"), keywords: "document pdf" },
      { id: "a-open", group: "IA", label: "Ouvrir l'assistant", icon: <Lightbulb />, run: () => (closePalette(), setAssistantOpen(true)), hint: "⌘J" },
      { id: "a-cmd", group: "IA", label: "Centre de commande IA", icon: <MessageSquare />, run: go("/command") },
      ...[...NAV, ...SECONDARY].map((n) => ({
        id: `nav-${n.href}`,
        group: "Aller à",
        label: n.label,
        icon: <n.icon />,
        run: go(n.href),
        hint: n.shortcut,
      })),
      ...(automations?.items ?? []).map((a) => ({
        id: `auto-${a.id}`,
        group: "Automatisations",
        label: `Lancer « ${a.name} »`,
        icon: <Play />,
        keywords: "automatisation workflow exécuter",
        run: async () => {
          closePalette();
          try {
            await api.post(`/api/automations/${a.id}/run`);
            toast({ kind: "success", title: "Automatisation lancée", description: a.name });
          } catch (e) {
            toast({ kind: "error", title: "Échec du lancement", description: (e as Error).message });
          }
        },
      })),
    ];

    const query = norm(q.trim());
    const filtered = query ? base.filter((i) => norm(`${i.label} ${i.keywords ?? ""} ${i.group}`).includes(query)) : base.filter((i) => i.group !== "Automatisations");

    const dynamic: Item[] = [];
    if (q.trim()) {
      dynamic.push(
        { id: "ask", group: "IA", label: `Demander à l'IA : « ${q.trim()} »`, icon: <Lightbulb />, run: () => (closePalette(), askAssistant(q.trim())) },
        { id: "mail", group: "Rechercher", label: `Rechercher « ${q.trim()} » dans Gmail`, icon: <Inbox />, run: go(`/inbox?q=${encodeURIComponent(q.trim())}`) },
        { id: "all", group: "Rechercher", label: `Tous les résultats pour « ${q.trim()} »`, icon: <Search />, run: go(`/search?q=${encodeURIComponent(q.trim())}`) },
      );
    } else {
      for (const r of prefs?.recentSearches?.slice(0, 4) ?? [])
        dynamic.push({ id: `recent-${r}`, group: "Recherches récentes", label: r, icon: <Clock />, run: () => setQ(r) });
    }
    const hits: Item[] = (search?.hits ?? []).map((h) => ({
      id: `hit-${h.type}-${h.id}`,
      group: HIT_LABELS[h.type] ?? "Résultats",
      label: h.title,
      hint: h.subtitle,
      icon: HIT_ICONS[h.type] ?? <ArrowRight />,
      run: go(h.href),
    }));
    return q.trim() ? [...hits, ...filtered, ...dynamic] : [...dynamic, ...filtered];
  }, [q, search, prefs, automations, router, closePalette, openCreate, askAssistant, setAssistantOpen, toast]);

  useEffect(() => setActive(0), [q, search]);

  useEffect(() => {
    list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === "Escape") {
      closePalette();
    }
  };

  if (typeof document === "undefined") return null;
  let lastGroup = "";

  return createPortal(
    <AnimatePresence>
      {paletteOpen && (
        <div className="fixed inset-0 z-[85] flex items-start justify-center px-3 pt-[10vh]">
          <motion.div className="absolute inset-0 bg-[var(--scrim)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} onClick={closePalette} />
          <motion.div
            role="dialog"
            aria-label="Palette de commandes"
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ type: "spring", bounce: 0, visualDuration: 0.18 }}
            className="relative flex max-h-[min(560px,75dvh)] w-full max-w-[640px] flex-col overflow-hidden rounded-[14px] border border-line bg-card shadow-[var(--shadow-lg)]"
            onKeyDown={onKey}
          >
            <div className="flex items-center gap-3 border-b border-line-soft px-4">
              <Search className={cn("size-4.5 shrink-0", isFetching ? "animate-pulse text-accent" : "text-fg-3")} />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher, créer, naviguer, demander à l'IA…"
                className="h-13 flex-1 bg-transparent text-[15px] text-fg placeholder:text-fg-3 focus:outline-none"
                aria-autocomplete="list"
                aria-activedescendant={items[active]?.id}
              />
              <Kbd>Échap</Kbd>
            </div>
            <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox">
              {items.length === 0 && <p className="t-sub px-3 py-8 text-center">Aucun résultat</p>}
              {items.map((it, i) => {
                const header = it.group !== lastGroup;
                lastGroup = it.group;
                return (
                  <div key={it.id}>
                    {header && <div className="t-label px-2.5 pt-2.5 pb-1">{it.group}</div>}
                    <button
                      id={it.id}
                      data-idx={i}
                      role="option"
                      aria-selected={i === active}
                      onMouseMove={() => setActive(i)}
                      onClick={it.run}
                      className={cn("flex h-9 w-full items-center gap-3 rounded-[8px] px-2.5 text-left text-[13.5px]", i === active ? "bg-raised text-fg" : "text-fg-2")}
                    >
                      <span className={cn("shrink-0 [&>svg]:size-4", i === active ? "text-accent" : "text-fg-3")}>{it.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.hint && <span className="t-meta max-w-[45%] shrink-0 truncate">{it.hint}</span>}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 border-t border-line-soft px-4 py-2 text-[11.5px] text-fg-3">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> naviguer
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> ouvrir
              </span>
              <span className="ml-auto flex items-center gap-1">
                <FilePlus2 className="size-3" /> BASILE OS
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
