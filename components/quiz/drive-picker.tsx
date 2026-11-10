"use client";
import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Clock, FileText, Folder, HardDrive, Search, X } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { useStatus } from "@/hooks/use-status";

export type PickedDoc = { id: string; name: string; mimeType?: string };
type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; iconLink?: string };
type Crumb = { id: string; name: string };

const FOLDER = "application/vnd.google-apps.folder";
const READABLE = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-word.document.macroenabled.12",
]);
/** Types de fichiers dont un quiz peut être tiré (même liste que côté serveur). */
const readable = (m: string) => READABLE.has(m) || m.startsWith("text/") || /^image\/(jpeg|png|webp|heic|heif)$/.test(m);

/**
 * Choix de documents dans Google Drive (ou d'un dossier avec `mode="folder"`) :
 * navigation par dossiers, fichiers récents et recherche.
 */
export function DrivePicker({
  open,
  onClose,
  onConfirm,
  initial,
  max = 12,
  mode = "files",
  title,
  confirmLabel,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (docs: PickedDoc[]) => void;
  initial?: PickedDoc[];
  max?: number;
  mode?: "files" | "folder";
  title?: string;
  confirmLabel?: string;
}) {
  const { data: status } = useStatus();
  const connected = status?.google.services.drive.status === "connected";
  const [selected, setSelected] = useState<PickedDoc[]>(initial ?? []);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [view, setView] = useState<"my" | "recent">("my");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  // À chaque ouverture, on repart de la sélection fournie.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(initial ?? []);
      setTrail([]);
      setView("my");
      setSearch("");
      setQ("");
    }
  }
  const folder = trail.at(-1) ?? null;
  const list = useInfiniteQuery({
    queryKey: ["drive-picker", folder?.id ?? null, view, q],
    queryFn: ({ pageParam }) => api.get<{ items: DriveFile[]; nextPageToken: string | null }>(`/api/drive${qs({ folder: folder?.id, view: folder || q ? undefined : view, q: q || undefined, pageToken: pageParam || undefined })}`),
    initialPageParam: "",
    getNextPageParam: (l) => l.nextPageToken ?? undefined,
    enabled: open && connected,
  });
  const items = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((f) => mode === "files" || f.mimeType === FOLDER);
  const has = (id: string) => selected.some((s) => s.id === id);
  const toggle = (f: DriveFile) => setSelected((l) => (l.some((s) => s.id === f.id) ? l.filter((s) => s.id !== f.id) : l.length >= max ? l : [...l, { id: f.id, name: f.name, mimeType: f.mimeType }]));
  const full = selected.length >= max;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={title ?? (mode === "folder" ? "Dossier de tes cours" : "Choisir des documents")}
      description={mode === "folder" ? "Seuls les documents rangés dans ce dossier (et ses sous-dossiers) serviront aux quiz du soir." : `Google Docs, PDF, Word, diaporamas ou photos de cours — ${max} au maximum.`}
      footer={
        mode === "folder" ? (
          <>
            <Button variant="ghost" onClick={() => (onConfirm([]), onClose())}>
              Tout mon Drive
            </Button>
            <Button variant="primary" disabled={!folder} onClick={() => (onConfirm(folder ? [{ id: folder.id, name: folder.name }] : []), onClose())}>
              {folder ? `Choisir « ${folder.name} »` : "Ouvre un dossier"}
            </Button>
          </>
        ) : (
          <>
            <span className="t-meta mr-auto">
              {selected.length} / {max} sélectionné{selected.length > 1 ? "s" : ""}
            </span>
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button variant="primary" onClick={() => (onConfirm(selected), onClose())}>
              {confirmLabel ?? "Valider"}
            </Button>
          </>
        )
      }
    >
      {status && !connected ? (
        <EmptyState
          icon={<HardDrive className="size-5" />}
          title="Google Drive n'est pas connecté"
          description="Connecte ton Drive pour choisir tes cours."
          action={
            <Link href="/integrations">
              <Button variant="primary">Ouvrir les intégrations</Button>
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={view}
              onChange={(v) => {
                setView(v);
                setTrail([]);
                setQ("");
                setSearch("");
              }}
              options={mode === "folder" ? [{ value: "my" as const, label: "Mon Drive", icon: <HardDrive /> }] : [{ value: "my" as const, label: "Mon Drive", icon: <HardDrive /> }, { value: "recent" as const, label: "Récents", icon: <Clock /> }]}
            />
            <form
              className="relative ml-auto w-full sm:w-[260px]"
              onSubmit={(e) => {
                e.preventDefault();
                setQ(search.trim());
                setTrail([]);
              }}
            >
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-3" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher dans Drive" className="pl-8" aria-label="Rechercher dans Drive" />
            </form>
          </div>

          {(trail.length > 0 || q) && (
            <nav className="flex flex-wrap items-center gap-1 text-[13px]" aria-label="Chemin Drive">
              <button
                onClick={() => {
                  setTrail([]);
                  setQ("");
                  setSearch("");
                }}
                className="rounded-[6px] px-1.5 py-0.5 text-fg-2 hover:bg-raised"
              >
                Mon Drive
              </button>
              {q && (
                <span className="flex items-center gap-1">
                  <ChevronRight className="size-3.5 text-fg-3" />« {q} »
                </span>
              )}
              {trail.map((c, i) => (
                <span key={c.id} className="flex items-center gap-1">
                  <ChevronRight className="size-3.5 text-fg-3" />
                  <button onClick={() => setTrail(trail.slice(0, i + 1))} className="max-w-[180px] truncate rounded-[6px] px-1.5 py-0.5 hover:bg-raised">
                    {c.name}
                  </button>
                </span>
              ))}
            </nav>
          )}

          <div className="h-[min(46dvh,420px)] overflow-y-auto rounded-[11px] border border-line-soft">
            {list.error ? (
              <ErrorState error={list.error} onRetry={() => list.refetch()} />
            ) : !list.data ? (
              <div className="space-y-2 p-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-9" />)}</div>
            ) : items.length === 0 ? (
              <EmptyState icon={<Folder className="size-5" />} title={q ? "Aucun résultat" : mode === "folder" ? "Aucun sous-dossier" : "Dossier vide"} />
            ) : (
              <ul className="p-1">
                {items.map((f) => {
                  const isFolder = f.mimeType === FOLDER;
                  const ok = isFolder || readable(f.mimeType);
                  const on = has(f.id);
                  return (
                    <li key={f.id}>
                      <button
                        disabled={!ok || (!isFolder && !on && full)}
                        onClick={() => {
                          if (isFolder) {
                            setTrail([...trail, { id: f.id, name: f.name }]);
                            setQ("");
                            setSearch("");
                          } else toggle(f);
                        }}
                        className={cn("focus-ring flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent", on && "bg-[color-mix(in_srgb,var(--accent)_9%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_13%,transparent)]")}
                      >
                        {isFolder ? (
                          <Folder className="size-4 shrink-0 text-fg-3" />
                        ) : (
                          <span className={cn("grid size-[18px] shrink-0 place-items-center rounded-[6px] border transition-colors", on ? "border-accent bg-accent text-white" : "border-fg-3/50")}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                        )}
                        {!isFolder && (f.iconLink ? <img src={f.iconLink} alt="" className="size-4 shrink-0" referrerPolicy="no-referrer" /> : <FileText className="size-4 shrink-0 text-fg-3" />)}
                        <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                        <span className="t-meta shrink-0">{!ok ? "Non lisible" : isFolder ? "" : relativeTime(f.modifiedTime)}</span>
                        {isFolder && <ChevronRight className="size-3.5 shrink-0 text-fg-3" />}
                      </button>
                    </li>
                  );
                })}
                {list.hasNextPage && (
                  <li className="p-2 text-center">
                    <Button size="sm" variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                      Afficher plus
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </div>

          {mode === "files" && selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((s) => (
                <span key={s.id} className="inline-flex h-6 max-w-[220px] items-center gap-1 rounded-[7px] border border-line bg-raised pr-1 pl-2 text-[12px]">
                  <span className="truncate">{s.name}</span>
                  <button onClick={() => setSelected(selected.filter((x) => x.id !== s.id))} className="shrink-0 rounded text-fg-3 hover:text-fg" aria-label={`Retirer ${s.name}`}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
