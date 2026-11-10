"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Lightbulb } from "lucide-react";
import { api } from "@/lib/client/api";
import { PageHeader, EmptyState, Badge } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useUI } from "./ui-context";

const LABELS: Record<string, string> = { task: "Tâches", project: "Projets", note: "Notes", contact: "Contacts", event: "Événements", email: "Emails", file: "Fichiers", conversation: "Conversations IA", knowledge: "Second Brain" };

/** Page de résultats de la recherche universelle, avec filtres par source. */
export function SearchView() {
  const sp = useSearchParams();
  const router = useRouter();
  const q = sp.get("q") ?? "";
  const [text, setText] = useState(q);
  const [types, setTypes] = useState<string[]>([]);
  const { askAssistant } = useUI();
  useEffect(() => setText(q), [q]);
  const { data, isFetching } = useQuery({ queryKey: ["search-page", q, types], queryFn: () => api.get<{ hits: { type: string; id: string; title: string; subtitle?: string; href: string }[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=20&remember=1${types.length ? `&types=${types.join(",")}` : ""}`), enabled: q.length > 1 });
  const groups = Object.entries(LABELS).map(([t, l]) => ({ t, l, hits: data?.hits.filter((h) => h.type === t) ?? [] })).filter((g) => g.hits.length);
  return (
    <div className="mx-auto max-w-[900px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader title="Recherche" description="Tâches, projets, notes, documents, contacts, événements, emails synchronisés, conversations IA et Second Brain." />
      <form onSubmit={(e) => (e.preventDefault(), router.replace(`/search?q=${encodeURIComponent(text.trim())}`))} className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
          <Input value={text} onChange={(e) => setText(e.target.value)} className="h-10 pl-9 text-[15px]" placeholder="Rechercher…" autoFocus />
        </div>
        <Button type="submit" variant="primary" loading={isFetching}>
          Rechercher
        </Button>
      </form>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {Object.entries(LABELS).map(([t, l]) => (
          <button key={t} onClick={() => setTypes((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))} className={types.includes(t) ? "rounded-[6px] border border-accent/40 bg-accent/10 px-2 py-1 text-[12px] text-accent" : "rounded-[6px] border border-line px-2 py-1 text-[12px] text-fg-3 hover:text-fg"}>
            {l}
          </button>
        ))}
      </div>
      {q && (
        <button onClick={() => askAssistant(`Recherche en langage naturel dans toutes mes données autorisées : ${q}`)} className="surface mb-4 flex w-full items-center gap-3 p-3 text-left hover:border-fg-3/40">
          <Lightbulb className="size-4 text-fg-3" />
          <span className="text-[13.5px]">Interpréter « {q} » avec l'IA (dates, personnes, projets)</span>
        </button>
      )}
      {q.length > 1 && !isFetching && !groups.length && <EmptyState icon={<Search className="size-5" />} title="Aucun résultat" />}
      {groups.map((g) => (
        <section key={g.t} className="mb-5">
          <h2 className="t-label mb-2">{g.l}</h2>
          <div className="surface divide-y divide-line-soft">
            {g.hits.map((h) => (
              <Link key={h.id} href={h.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-raised/40">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px]">{h.title}</span>
                  {h.subtitle && <span className="t-meta block truncate">{h.subtitle}</span>}
                </span>
                <Badge>{g.l}</Badge>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
