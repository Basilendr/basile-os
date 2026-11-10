"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Folder, FolderPlus, Upload, LayoutGrid, List, Search, Star, MoreHorizontal, Pencil, Trash2, Download, FolderInput, FileText, FileImage, FileSpreadsheet, Presentation, File as FileIcon, ChevronRight, Lightbulb, NotebookPen, HardDrive } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { relativeTime } from "@/lib/utils";
import { PageHeader, EmptyState, Skeleton, Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { Menu } from "@/components/ui/menu";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import { useProjects } from "@/hooks/use-data";
import { DriveView } from "./drive-view";
import { FilesTabs } from "./files-tabs";

type Item = { id: string; name: string; isFolder: boolean; mimeType: string | null; size: number; parentId: string | null; projectId: string | null; favorite: boolean; hasText: boolean; kind: string; createdAt: string; updatedAt: string };

const KIND_ICON: Record<string, React.ReactNode> = { folder: <Folder />, pdf: <FileText />, image: <FileImage />, document: <FileText />, spreadsheet: <FileSpreadsheet />, presentation: <Presentation />, other: <FileIcon /> };
const KIND_COLOR: Record<string, string> = { folder: "var(--accent)", pdf: "var(--danger)", image: "var(--accent-2)", document: "var(--accent)", spreadsheet: "var(--success)", presentation: "var(--warning)", other: "var(--fg-3)" };
const size = (n: number) => (n < 1024 ? `${n} o` : n < 1048576 ? `${Math.round(n / 1024)} Ko` : `${(n / 1048576).toFixed(1)} Mo`);

export function FilesView() {
  const sp = useSearchParams();
  return sp.get("tab") === "drive" ? <DriveView /> : <LocalFiles />;
}

function LocalFiles() {
  const sp = useSearchParams();
  const router = useRouter();
  const folder = sp.get("folder");
  const fileId = sp.get("file");
  const projectParam = sp.get("project");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState("name");
  const [favorite, setFavorite] = useState(false);
  const [layout, setLayout] = useState<"grid" | "list">("list");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [newFolder, setNewFolder] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = ["files", folder, q, kind, sort, favorite];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<{ items: Item[]; path: { id: string; name: string }[] }>(`/api/files${qs({ parentId: folder ?? "root", q, kind, sort, favorite: favorite ? "1" : undefined })}`) });

  useEffect(() => {
    if (sp.get("upload")) setTimeout(() => input.current?.click(), 300);
  }, [sp]);

  const nav = (p: Record<string, string | null>) => {
    const s = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(p)) v ? s.set(k, v) : s.delete(k);
    s.delete("upload");
    router.replace(`/files?${s}`, { scroll: false });
  };

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    setUploading(list.length);
    const fd = new FormData();
    list.forEach((f) => fd.append("file", f));
    if (folder) fd.append("parentId", folder);
    if (projectParam) fd.append("projectId", projectParam);
    try {
      const r = await fetch("/api/files/upload", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Import impossible");
      toast({ kind: "success", title: `${d.items.length} fichier(s) importé(s)` });
      qc.invalidateQueries({ queryKey: ["files"] });
    } catch (e) {
      toast({ kind: "error", title: "Import échoué", description: (e as Error).message });
    } finally {
      setUploading(0);
    }
  };

  const items = data?.items ?? [];
  return (
    <div
      className="relative mx-auto max-w-[1600px] px-1 pt-1 pb-10 md:px-3 md:pt-2"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
    >
      <PageHeader
        title="Fichiers"
        description="Stockage privé sur le serveur BASILE OS · PDF, images, documents, tableurs, présentations (25 Mo max)."
        actions={
          <>
            <Button size="sm" icon={<FolderPlus className="size-3.5" />} onClick={() => setNewFolder(true)}>
              Dossier
            </Button>
            <Button size="sm" variant="primary" loading={!!uploading} icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>
              Importer
            </Button>
            <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
          </>
        }
      >
        <FilesTabs />
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-[13px]" aria-label="Fil d'Ariane">
          <button onClick={() => nav({ folder: null })} className="inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-fg-2 hover:bg-raised hover:text-fg">
            <HardDrive className="size-3.5" /> Mes fichiers
          </button>
          {data?.path.map((p) => (
            <span key={p.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-fg-3" />
              <button onClick={() => nav({ folder: p.id })} className="truncate rounded-[6px] px-1.5 py-1 hover:bg-raised">
                {p.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou contenu…" className="h-8 w-52 pl-8" />
        </div>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Type">
          <option value="">Tous les types</option>
          <option value="pdf">PDF</option>
          <option value="image">Images</option>
          <option value="document">Documents</option>
          <option value="spreadsheet">Tableurs</option>
          <option value="presentation">Présentations</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Tri">
          <option value="name">Nom</option>
          <option value="updated">Modifié</option>
          <option value="size">Taille</option>
          <option value="type">Type</option>
        </Select>
        <Button size="sm" variant={favorite ? "secondary" : "ghost"} icon={<Star className={favorite ? "size-3.5 fill-warning text-warning" : "size-3.5"} />} onClick={() => setFavorite((f) => !f)}>
          Favoris
        </Button>
        <Segmented size="sm" value={layout} onChange={setLayout} options={[{ value: "list", label: "", icon: <List /> }, { value: "grid", label: "", icon: <LayoutGrid /> }]} />
      </div>

      {isLoading ? (
        <Skeleton className="h-48 rounded-[12px]" />
      ) : items.length === 0 ? (
        <div className="surface border-dashed">
          <EmptyState icon={<Upload className="size-5" />} title={q || kind || favorite ? "Aucun résultat" : "Dossier vide"} description="Glisse des fichiers ici ou utilise « Importer »." />
        </div>
      ) : layout === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((f) => (
            <div key={f.id} onDoubleClick={() => (f.isFolder ? nav({ folder: f.id }) : nav({ file: f.id }))} onClick={() => (f.isFolder ? nav({ folder: f.id }) : nav({ file: f.id }))} className="surface group relative cursor-pointer p-3 transition-colors hover:border-fg-3/40">
              <div className="mb-3 grid aspect-[4/3] place-items-center overflow-hidden rounded-[8px] bg-bg-2 [&>svg]:size-8" style={{ color: KIND_COLOR[f.kind] }}>
                {f.kind === "image" ? <img src={`/api/files/${f.id}/content`} alt="" className="size-full object-cover" loading="lazy" /> : KIND_ICON[f.kind]}
              </div>
              <p className="truncate text-[13px] font-medium">{f.name}</p>
              <p className="t-meta">{f.isFolder ? "Dossier" : size(f.size)}</p>
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100">
                <ItemMenu f={f} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="surface overflow-hidden">
          {items.map((f) => (
            <div key={f.id} onClick={() => (f.isFolder ? nav({ folder: f.id }) : nav({ file: f.id }))} className="group flex cursor-pointer items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0 hover:bg-raised/40">
              <span className="[&>svg]:size-4.5" style={{ color: KIND_COLOR[f.kind] }}>
                {KIND_ICON[f.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{f.name}</span>
              {f.favorite && <Star className="size-3.5 fill-warning text-warning" />}
              {f.projectId && <Badge>Projet</Badge>}
              <span className="t-meta hidden w-20 text-right sm:block">{f.isFolder ? "—" : size(f.size)}</span>
              <span className="t-meta hidden w-28 text-right md:block">{relativeTime(f.updatedAt)}</span>
              <ItemMenu f={f} />
            </div>
          ))}
        </div>
      )}

      {dragging && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-accent/10 backdrop-blur-[2px]">
          <div className="rounded-[16px] border-2 border-dashed border-accent bg-card px-10 py-8 text-center">
            <Upload className="mx-auto mb-2 size-6 text-accent" />
            <p className="t-section">Dépose pour importer</p>
          </div>
        </motion.div>
      )}
      <NewFolderDialog open={newFolder} onClose={() => setNewFolder(false)} parentId={folder} />
      <FilePreview id={fileId} onClose={() => nav({ file: null })} />
    </div>
  );
}

function NewFolderDialog({ open, onClose, parentId }: { open: boolean; onClose: () => void; parentId: string | null }) {
  const [name, setName] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouveau dossier"
      size="sm"
      footer={
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              await api.post("/api/files", { name: name.trim(), parentId });
              qc.invalidateQueries({ queryKey: ["files"] });
              setName("");
              onClose();
            } catch (e) {
              toast({ kind: "error", title: "Création impossible", description: (e as Error).message });
            }
          }}
        >
          Créer
        </Button>
      }
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du dossier" data-autofocus />
    </Dialog>
  );
}

function ItemMenu({ f }: { f: Item }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [rename, setRename] = useState(false);
  const [move, setMove] = useState(false);
  const [del, setDel] = useState(false);
  const [name, setName] = useState(f.name);
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api.patch(`/api/files/${f.id}`, body);
      qc.invalidateQueries({ queryKey: ["files"] });
    } catch (e) {
      toast({ kind: "error", title: "Action impossible", description: (e as Error).message });
    }
  };
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Menu
        trigger={({ toggle }) => (
          <button onClick={toggle} className="grid size-7 place-items-center rounded-[7px] text-fg-3 hover:bg-raised hover:text-fg" aria-label="Options">
            <MoreHorizontal className="size-4" />
          </button>
        )}
        items={[
          ...(!f.isFolder ? [{ label: "Télécharger", icon: <Download />, onSelect: () => window.open(`/api/files/${f.id}/content?download=1`) }] : []),
          { label: f.favorite ? "Retirer des favoris" : "Ajouter aux favoris", icon: <Star />, onSelect: () => patch({ favorite: !f.favorite }) },
          { label: "Renommer", icon: <Pencil />, onSelect: () => setRename(true) },
          { label: "Déplacer", icon: <FolderInput />, onSelect: () => setMove(true) },
          { type: "separator" },
          { label: "Supprimer", icon: <Trash2 />, danger: true, onSelect: () => setDel(true) },
        ]}
      />
      <Dialog open={rename} onClose={() => setRename(false)} title="Renommer" size="sm" footer={<Button variant="primary" onClick={() => (patch({ name }), setRename(false))}>Renommer</Button>}>
        <Input value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
      </Dialog>
      <MoveDialog open={move} onClose={() => setMove(false)} item={f} onMove={(parentId) => (patch({ parentId }), setMove(false))} />
      <ConfirmDialog
        open={del}
        onClose={() => setDel(false)}
        danger
        title={`Supprimer « ${f.name} » ?`}
        description={f.isFolder ? "Le dossier et tout son contenu seront définitivement supprimés." : "Le fichier sera définitivement supprimé du stockage."}
        confirmLabel="Supprimer"
        onConfirm={async () => {
          try {
            await api.del(`/api/files/${f.id}`);
            qc.invalidateQueries({ queryKey: ["files"] });
          } catch (e) {
            toast({ kind: "error", title: "Suppression impossible", description: (e as Error).message });
          }
          setDel(false);
        }}
      />
    </span>
  );
}

function MoveDialog({ open, onClose, item, onMove }: { open: boolean; onClose: () => void; item: Item; onMove: (parentId: string | null) => void }) {
  const [cur, setCur] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["files-move", cur], queryFn: () => api.get<{ items: Item[]; path: { id: string; name: string }[] }>(`/api/files?parentId=${cur ?? "root"}`), enabled: open });
  return (
    <Dialog open={open} onClose={onClose} title={`Déplacer « ${item.name} »`} footer={<Button variant="primary" onClick={() => onMove(cur)}>Déplacer ici</Button>}>
      <div className="t-meta mb-2 flex flex-wrap items-center gap-1">
        <button onClick={() => setCur(null)} className="hover:text-fg">
          Mes fichiers
        </button>
        {data?.path.map((p) => (
          <span key={p.id}>
            / <button onClick={() => setCur(p.id)} className="hover:text-fg">{p.name}</button>
          </span>
        ))}
      </div>
      <div className="max-h-64 overflow-y-auto rounded-[9px] border border-line-soft">
        {data?.items.filter((f) => f.isFolder && f.id !== item.id).map((f) => (
          <button key={f.id} onClick={() => setCur(f.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-raised">
            <Folder className="size-4 text-accent" /> {f.name}
          </button>
        ))}
        {!data?.items.some((f) => f.isFolder && f.id !== item.id) && <p className="t-meta p-3">Aucun sous-dossier.</p>}
      </div>
    </Dialog>
  );
}

function FilePreview({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: f } = useQuery({ queryKey: ["file", id], queryFn: () => api.get<Item & { textContent: string | null }>(`/api/files/${id}`), enabled: !!id });
  const { data: projects } = useProjects();
  const { askAssistant } = useUI();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [noting, setNoting] = useState(false);
  const kind = f?.mimeType === "application/pdf" ? "pdf" : f?.mimeType?.startsWith("image/") ? "image" : f?.mimeType?.startsWith("text/") ? "text" : "other";
  return (
    <Sheet open={!!id} onClose={onClose} title={f?.name ?? "Fichier"} width={640}>
      {f && (
        <div className="flex flex-col gap-4 p-4">
          <div className="overflow-hidden rounded-[10px] border border-line-soft bg-bg-2">
            {kind === "image" ? (
              <img src={`/api/files/${f.id}/content`} alt={f.name} className="max-h-[50vh] w-full object-contain" />
            ) : kind === "pdf" ? (
              <iframe src={`/api/files/${f.id}/content`} title={f.name} className="h-[55vh] w-full bg-white" />
            ) : f.textContent ? (
              <pre className="max-h-[50vh] overflow-auto p-4 font-sans text-[13px] whitespace-pre-wrap text-fg-2">{f.textContent.slice(0, 20_000)}</pre>
            ) : (
              <p className="t-sub p-6 text-center">Aperçu indisponible pour ce format.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/files/${f.id}/content?download=1`}>
              <Button size="sm" icon={<Download className="size-3.5" />}>
                Télécharger
              </Button>
            </a>
            <Button size="sm" variant="ghost" icon={<Lightbulb className="size-3.5 text-fg-3" />} disabled={!f.textContent} onClick={() => (onClose(), askAssistant(`Résume le document « ${f.name} » (fileId ${f.id}) et extrais les informations et dates importantes, en citant le document.`))}>
              Résumer
            </Button>
            <Button size="sm" variant="ghost" disabled={!f.textContent} onClick={() => (onClose(), askAssistant(`J'ai une question sur le document « ${f.name} » (fileId ${f.id}) : `))}>
              Poser une question
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={noting}
              icon={<NotebookPen className="size-3.5" />}
              disabled={!f.textContent}
              onClick={async () => {
                setNoting(true);
                try {
                  const r = await api.post<{ text: string }>("/api/ai/transform", { action: "summarize", text: f.textContent!.slice(0, 100_000), title: f.name });
                  const n = await api.post<{ id: string }>("/api/notes", { title: `Synthèse — ${f.name}`, contentText: r.text, content: { type: "doc", content: r.text.split("\n").filter(Boolean).map((l) => ({ type: "paragraph", content: [{ type: "text", text: l.replace(/^[-*]\s*/, "• ") }] })) }, projectId: f.projectId });
                  await api.post("/api/brain/links", { fromType: "note", fromId: n.id, toType: "file", toId: f.id, relation: "synthèse" });
                  toast({ kind: "success", title: "Note structurée créée", action: { label: "Ouvrir", run: () => (window.location.href = `/notes?note=${n.id}`) } });
                } catch (e) {
                  toast({ kind: "error", title: "Note non générée", description: (e as Error).message });
                } finally {
                  setNoting(false);
                }
              }}
            >
              Générer une note
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            <span className="t-meta">Type</span>
            <span>{f.mimeType}</span>
            <span className="t-meta">Taille</span>
            <span>{size(f.size)}</span>
            <span className="t-meta">Ajouté</span>
            <span>{new Date(f.createdAt).toLocaleString("fr-FR")}</span>
            <span className="t-meta">Texte extrait</span>
            <span>{f.textContent ? `${f.textContent.length.toLocaleString("fr-FR")} caractères (recherche et IA)` : "aucun"}</span>
            <span className="t-meta self-center">Projet</span>
            <Select
              value={f.projectId ?? ""}
              onChange={async (e) => {
                try {
                  await api.patch(`/api/files/${f.id}`, { projectId: e.target.value || null });
                  qc.invalidateQueries({ queryKey: ["file", id] });
                  qc.invalidateQueries({ queryKey: ["files"] });
                } catch (err) {
                  toast({ kind: "error", title: "Liaison impossible", description: (err as Error).message });
                }
              }}
              className="h-8"
            >
              <option value="">Aucun</option>
              {projects?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <p className="t-meta">Intégration Google Drive : autorisation disponible dans Intégrations, import non encore implémenté.</p>
        </div>
      )}
    </Sheet>
  );
}

