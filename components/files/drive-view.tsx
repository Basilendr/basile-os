"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Clock, Download, ExternalLink, FileText, Folder, HardDrive, Import, Search, Star, Users } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useStatus } from "@/hooks/use-status";
import { FilesTabs } from "./files-tabs";

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; size?: string; iconLink?: string; webViewLink?: string; thumbnailLink?: string; starred?: boolean; owners?: { displayName: string; emailAddress: string }[]; shared?: boolean };
type View = "my" | "recent" | "shared" | "starred";
const FOLDER = "application/vnd.google-apps.folder";
const KIND: Record<string, string> = {
  "application/vnd.google-apps.document": "Google Docs",
  "application/vnd.google-apps.spreadsheet": "Google Sheets",
  "application/vnd.google-apps.presentation": "Google Slides",
  "application/vnd.google-apps.drawing": "Dessin Google",
  "application/pdf": "PDF",
  [FOLDER]: "Dossier",
};
const kindOf = (m: string) => KIND[m] ?? (m.startsWith("image/") ? "Image" : m.startsWith("video/") ? "Vidéo" : m.split("/").pop()?.toUpperCase() ?? "Fichier");
const human = (n?: string) => (!n ? "—" : Number(n) < 1048576 ? `${Math.max(1, Math.round(Number(n) / 1024))} Ko` : `${(Number(n) / 1048576).toFixed(1)} Mo`);
const previewable = (m: string) => m === "application/pdf" || /^image\/(png|jpeg|gif|webp)$/.test(m) || m === "text/plain" || ["application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet", "application/vnd.google-apps.presentation", "application/vnd.google-apps.drawing"].includes(m);

/** Google Drive dans BASILE OS : le contenu transite par le serveur, le jeton Google ne quitte jamais le serveur. */
export function DriveView() {
  const sp = useSearchParams();
  const router = useRouter();
  const { data: status } = useStatus();
  const folder = sp.get("folder");
  const view = (sp.get("view") as View) || "my";
  const q = sp.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [preview, setPreview] = useState<DriveFile | null>(null);
  const connected = status?.google.services.drive.status === "connected";
  const nav = (p: Record<string, string | null>) => {
    const s = new URLSearchParams(sp.toString());
    s.set("tab", "drive");
    for (const [k, v] of Object.entries(p)) v ? s.set(k, v) : s.delete(k);
    router.replace(`/files?${s}`, { scroll: false });
  };
  const list = useInfiniteQuery({
    queryKey: ["drive", folder, view, q],
    queryFn: ({ pageParam }) => api.get<{ items: DriveFile[]; nextPageToken: string | null; path: { id: string; name: string }[] }>(`/api/drive${qs({ folder: folder ?? undefined, view: folder ? undefined : view, q: q || undefined, pageToken: pageParam || undefined })}`),
    initialPageParam: "",
    getNextPageParam: (l) => l.nextPageToken ?? undefined,
    enabled: connected,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const path = list.data?.pages[0]?.path ?? [];

  return (
    <div className="mx-auto max-w-[1600px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader title="Fichiers" description="Tes documents Google Drive, consultables et importables dans BASILE OS.">
        <FilesTabs />
      </PageHeader>
      {status && !connected ? (
        <Card>
          <EmptyState
            icon={<HardDrive className="size-5" />}
            title="Google Drive n'est pas connecté"
            description={status.google.configured ? "Autorise l'accès en lecture à Drive pour parcourir et prévisualiser tes documents ici." : "La connexion Google n'est pas encore configurée : colle l'ID client OAuth dans Paramètres → Configuration."}
            action={
              <Link href={status.google.configured ? "/api/integrations/google/connect?services=drive" : "/settings?s=config"}>
                <Button variant="primary">{status.google.configured ? "Connecter Google Drive" : "Ouvrir la configuration"}</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
            <Segmented
              size="sm"
              value={folder ? "my" : view}
              onChange={(v) => nav({ view: v, folder: null, q: null })}
              options={[
                { value: "my", label: "Mon Drive", icon: <HardDrive /> },
                { value: "recent", label: "Récents", icon: <Clock /> },
                { value: "shared", label: "Partagés", icon: <Users /> },
                { value: "starred", label: "Suivis", icon: <Star /> },
              ]}
            />
            <form
              className="relative ml-auto w-full sm:w-[280px]"
              onSubmit={(e) => {
                e.preventDefault();
                nav({ q: search.trim() || null, folder: null });
              }}
            >
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-3" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher dans Drive" className="pl-8" aria-label="Rechercher dans Drive" />
            </form>
          </div>
          {(folder || q) && (
            <nav className="flex items-center gap-1 border-b border-line-soft px-4 py-2 text-[13px]" aria-label="Chemin Drive">
              <button onClick={() => nav({ folder: null, q: null })} className="rounded-[6px] px-1.5 py-0.5 text-fg-2 hover:bg-raised">
                Mon Drive
              </button>
              {q && (
                <span className="flex items-center gap-1">
                  <ChevronRight className="size-3.5 text-fg-3" />« {q} »
                </span>
              )}
              {path.map((p) => (
                <span key={p.id} className="flex items-center gap-1">
                  <ChevronRight className="size-3.5 text-fg-3" />
                  <button onClick={() => nav({ folder: p.id })} className="max-w-[200px] truncate rounded-[6px] px-1.5 py-0.5 hover:bg-raised">
                    {p.name}
                  </button>
                </span>
              ))}
            </nav>
          )}
          {list.error ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data ? (
            <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : items.length === 0 ? (
            <EmptyState icon={<Folder className="size-5" />} title={q ? "Aucun résultat" : "Dossier vide"} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="t-meta text-left">
                    <th className="px-4 py-2 font-medium">Nom</th>
                    <th className="px-2 py-2 font-medium">Type</th>
                    <th className="px-2 py-2 font-medium">Propriétaire</th>
                    <th className="px-2 py-2 font-medium">Modifié</th>
                    <th className="px-2 py-2 text-right font-medium">Taille</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((f) => (
                    <tr key={f.id} className="cursor-pointer border-t border-line-soft hover:bg-raised/40" onClick={() => (f.mimeType === FOLDER ? nav({ folder: f.id, q: null }) : setPreview(f))}>
                      <td className="px-4 py-2.5">
                        <span className="flex min-w-0 items-center gap-2.5">
                          {f.iconLink ? <img src={f.iconLink} alt="" className="size-4 shrink-0" referrerPolicy="no-referrer" /> : f.mimeType === FOLDER ? <Folder className="size-4 text-fg-3" /> : <FileText className="size-4 text-fg-3" />}
                          <span className="truncate font-medium">{f.name}</span>
                          {f.starred && <Star className="size-3 shrink-0 fill-warning text-warning" />}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-fg-2">{kindOf(f.mimeType)}</td>
                      <td className="max-w-[180px] truncate px-2 py-2.5 text-fg-2">{f.owners?.[0]?.displayName ?? "—"}</td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-fg-2">{relativeTime(f.modifiedTime)}</td>
                      <td className="t-num px-2 py-2.5 text-right text-fg-3">{f.mimeType === FOLDER ? "—" : human(f.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.hasNextPage && (
                <div className="border-t border-line-soft p-3">
                  <Button className="w-full justify-center" variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                    Charger plus
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
      <DrivePreview file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function DrivePreview({ file, onClose }: { file: DriveFile | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const canPreview = file ? previewable(file.mimeType) : false;
  const { data: meta } = useQuery({ queryKey: ["drive-file", file?.id], queryFn: () => api.get<DriveFile>(`/api/drive/${file!.id}`), enabled: !!file });
  return (
    <Sheet open={!!file} onClose={onClose} title={file?.name ?? ""} width={720}>
      {file && (
        <div className="flex h-full flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-meta">
              {kindOf(file.mimeType)} · modifié {relativeTime(file.modifiedTime)}
              {meta?.owners?.[0] ? ` · ${meta.owners[0].displayName}` : ""}
            </span>
            <span className="ml-auto flex gap-1.5">
              {file.webViewLink && (
                <a href={file.webViewLink} target="_blank" rel="noreferrer">
                  <Button size="sm" icon={<ExternalLink className="size-3.5" />}>
                    Ouvrir dans Drive
                  </Button>
                </a>
              )}
              <a href={`/api/drive/${file.id}/content?download=1`}>
                <Button size="sm" icon={<Download className="size-3.5" />}>
                  Télécharger
                </Button>
              </a>
              <Button
                size="sm"
                variant="primary"
                loading={busy}
                icon={<Import className="size-3.5" />}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.post<{ id: string; name: string }>(`/api/drive/${file.id}/import`, {});
                    qc.invalidateQueries({ queryKey: ["files"] });
                    toast({ kind: "success", title: "Importé dans Mes fichiers", description: r.name });
                  } catch (e) {
                    toast({ kind: "error", title: "Import impossible", description: (e as Error).message });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Importer
              </Button>
            </span>
          </div>
          {canPreview ? (
            file.mimeType.startsWith("image/") ? (
              <img src={`/api/drive/${file.id}/content`} alt={file.name} className="max-h-[70vh] w-full rounded-[12px] border border-line object-contain" />
            ) : (
              <iframe title={`Aperçu — ${file.name}`} src={`/api/drive/${file.id}/content`} className={cn("min-h-[70vh] w-full flex-1 rounded-[12px] border border-line bg-white")} />
            )
          ) : (
            <EmptyState icon={<FileText className="size-5" />} title="Aperçu non disponible" description="Ce type de fichier ne peut pas être affiché ici. Ouvre-le dans Drive ou télécharge-le." />
          )}
          <p className="t-meta">Les documents Google sont convertis en PDF pour l'aperçu et l'import.</p>
        </div>
      )}
    </Sheet>
  );
}
