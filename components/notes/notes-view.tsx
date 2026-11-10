"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { generateText } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { Plus, Search, Star, FolderClosed, FolderPlus, Hash, NotebookPen, History, Trash2, MoreHorizontal, Lightbulb, ArrowLeft, Check, Loader2, AlertCircle, Inbox as InboxIcon, Pencil, X, FolderKanban } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, Skeleton, Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import { useNotes, useProjects } from "@/hooks/use-data";
import { NoteEditor } from "./editor";
import { noteExtensions } from "./extensions";
import { NoteAiMenu } from "./note-ai";
import type { Note } from "@/types";

type Folder = { id: string; name: string; parentId: string | null; count: number };

export function NotesView() {
  const sp = useSearchParams();
  const router = useRouter();
  const noteId = sp.get("note");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<{ folderId?: string; tag?: string; favorite?: boolean }>({});
  const { data: notes, isLoading } = useNotes({ ...filter, q: q || undefined });
  const { data: folders } = useQuery({ queryKey: ["note-folders"], queryFn: () => api.get<{ items: Folder[] }>("/api/note-folders") });
  const { data: tags } = useQuery({ queryKey: ["note-tags"], queryFn: () => api.get<{ items: { tag: string; n: number }[] }>("/api/notes/tags") });
  const { openCreate } = useUI();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newFolder, setNewFolder] = useState<string | null>(null);

  const open = (id: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (id) p.set("note", id);
    else p.delete("note");
    router.replace(`/notes?${p}`, { scroll: false });
  };

  const createNote = () => openCreate("note", filter.folderId && filter.folderId !== "none" ? { folderId: filter.folderId } : {});

  return (
    <div className="surface flex h-full min-h-0 overflow-hidden">
      {/* Colonne de navigation */}
      <aside className={cn("flex w-full shrink-0 flex-col border-r border-line-soft bg-bg md:w-[300px]", noteId && "hidden md:flex")}>
        <div className="flex items-center gap-2 px-4 pt-5 pb-3">
          <h1 className="t-title flex-1">Notes</h1>
          <Button size="icon-sm" variant="ghost" onClick={() => setNewFolder("")} aria-label="Nouveau dossier">
            <FolderPlus className="size-4" />
          </Button>
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={createNote}>
            Note
          </Button>
        </div>
        <div className="relative px-4 pb-2">
          <Search className="pointer-events-none absolute top-1/2 left-6.5 size-3.5 -translate-y-1/2 text-fg-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher dans les notes…" className="pl-8" />
        </div>
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          <NavItem active={!filter.folderId && !filter.tag && !filter.favorite} icon={<NotebookPen />} label="Toutes les notes" onClick={() => setFilter({})} />
          <NavItem active={!!filter.favorite} icon={<Star />} label="Favoris" onClick={() => setFilter({ favorite: true })} />
          <NavItem active={filter.folderId === "none"} icon={<InboxIcon />} label="Sans dossier" onClick={() => setFilter({ folderId: "none" })} />
          {folders?.items.map((f) => (
            <FolderItem key={f.id} f={f} active={filter.folderId === f.id} onClick={() => setFilter({ folderId: f.id })} onDeleted={() => setFilter({})} />
          ))}
          {newFolder !== null && (
            <form
              className="flex gap-1 px-1"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newFolder.trim()) return setNewFolder(null);
                try {
                  await api.post("/api/note-folders", { name: newFolder.trim() });
                  qc.invalidateQueries({ queryKey: ["note-folders"] });
                } catch (err) {
                  toast({ kind: "error", title: "Dossier non créé", description: (err as Error).message });
                }
                setNewFolder(null);
              }}
            >
              <Input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Nom du dossier" onBlur={() => !newFolder.trim() && setNewFolder(null)} className="h-8" />
            </form>
          )}
          {!!tags?.items.length && (
            <div className="mt-2 flex flex-wrap gap-1 px-2">
              {tags.items.slice(0, 16).map((t) => (
                <button key={t.tag} onClick={() => setFilter(filter.tag === t.tag ? {} : { tag: t.tag })} className={cn("rounded-[5px] border px-1.5 py-0.5 text-[11.5px]", filter.tag === t.tag ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-fg-3 hover:text-fg")}>
                  #{t.tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line-soft p-2">
          {isLoading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-14" />)
          ) : notes?.items.length === 0 ? (
            <EmptyState icon={<NotebookPen className="size-5" />} title="Aucune note" description={q ? "Aucun résultat." : "Capture une idée, un compte rendu ou un plan."} />
          ) : (
            notes?.items.map((n) => (
              <button key={n.id} onClick={() => open(n.id)} className={cn("mb-0.5 flex w-full flex-col items-start rounded-[9px] px-3 py-2.5 text-left transition-colors", n.id === noteId ? "bg-raised" : "hover:bg-raised/50")}>
                <span className="flex w-full items-center gap-1.5">
                  {n.favorite && <Star className="size-3 shrink-0 fill-warning text-warning" />}
                  <span className="truncate text-[13.5px] font-medium">{n.title || "Sans titre"}</span>
                </span>
                <span className="t-meta line-clamp-1 w-full">{n.excerpt || "Note vide"}</span>
                <span className="t-meta mt-0.5">{relativeTime(n.updatedAt)}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Éditeur */}
      <section className={cn("min-w-0 flex-1 overflow-y-auto", !noteId && "hidden md:block")}>
        {noteId ? (
          <NotePane key={noteId} id={noteId} folders={folders?.items ?? []} onBack={() => open(null)} />
        ) : (
          <EmptyState className="h-full" icon={<NotebookPen className="size-5" />} title="Sélectionne une note" description="Ou crée-en une nouvelle — l'enregistrement est automatique." action={<Button variant="primary" onClick={createNote}>Nouvelle note</Button>} />
        )}
      </section>
    </div>
  );
}

function NavItem({ active, icon, label, onClick, count }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void; count?: number }) {
  return (
    <button onClick={onClick} className={cn("flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] [&>svg]:size-3.5", active ? "bg-raised text-fg [&>svg]:text-accent" : "text-fg-2 hover:bg-raised/50 [&>svg]:text-fg-3")}>
      {icon}
      <span className="flex-1 truncate text-left">{label}</span>
      {count !== undefined && <span className="t-num text-[11.5px] text-fg-3">{count}</span>}
    </button>
  );
}

function FolderItem({ f, active, onClick, onDeleted }: { f: Folder; active: boolean; onClick: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [rename, setRename] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  if (rename !== null)
    return (
      <form
        className="px-1"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (rename.trim()) await api.patch(`/api/note-folders/${f.id}`, { name: rename.trim() });
            qc.invalidateQueries({ queryKey: ["note-folders"] });
          } catch (err) {
            toast({ kind: "error", title: "Renommage impossible", description: (err as Error).message });
          }
          setRename(null);
        }}
      >
        <Input autoFocus value={rename} onChange={(e) => setRename(e.target.value)} onBlur={() => setRename(null)} className="h-8" />
      </form>
    );
  return (
    <div className="group relative">
      <NavItem active={active} icon={<FolderClosed />} label={f.name} onClick={onClick} count={f.count} />
      <div className="absolute top-1 right-1 hidden group-hover:block">
        <Menu
          trigger={({ toggle }) => (
            <button onClick={toggle} className="grid size-6 place-items-center rounded-[6px] bg-raised text-fg-3 hover:text-fg" aria-label="Options du dossier">
              <MoreHorizontal className="size-3.5" />
            </button>
          )}
          items={[
            { label: "Renommer", icon: <Pencil />, onSelect: () => setRename(f.name) },
            { label: "Supprimer", icon: <Trash2 />, danger: true, onSelect: () => setDel(true) },
          ]}
        />
      </div>
      <ConfirmDialog
        open={del}
        onClose={() => setDel(false)}
        title={`Supprimer le dossier « ${f.name} » ?`}
        description="Les notes qu'il contient sont conservées et passent dans « Sans dossier »."
        danger
        confirmLabel="Supprimer"
        onConfirm={async () => {
          await api.del(`/api/note-folders/${f.id}`).catch((e) => toast({ kind: "error", title: "Suppression impossible", description: e.message }));
          qc.invalidateQueries({ queryKey: ["note-folders"] });
          qc.invalidateQueries({ queryKey: ["notes"] });
          setDel(false);
          onDeleted();
        }}
      />
    </div>
  );
}

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

/** Volet d'édition : sauvegarde automatique (anti-rebond), protection des conflits, brouillon local de secours. */
function NotePane({ id, folders, onBack }: { id: string; folders: Folder[]; onBack: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: note, error } = useQuery({ queryKey: ["note", id], queryFn: () => api.get<Note>(`/api/notes/${id}`), staleTime: Infinity, refetchOnWindowFocus: false });
  const { data: projects } = useProjects();
  const [title, setTitle] = useState("");
  const [state, setState] = useState<SaveState>("saved");
  const [tagInput, setTagInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const pending = useRef<{ content?: Record<string, unknown>; contentText?: string; title?: string }>({});
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftKey = `bos.note-draft.${id}`;

  useEffect(() => {
    if (note) {
      setTitle(note.title);
      revision.current = note.revision;
    }
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const body = pending.current;
    if (!Object.keys(body).length) return;
    pending.current = {};
    setState("saving");
    try {
      const n = await api.patch<Note>(`/api/notes/${id}`, { ...body, baseRevision: revision.current });
      revision.current = n.revision;
      setState(Object.keys(pending.current).length ? "dirty" : "saved");
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      qc.invalidateQueries({ queryKey: ["notes"] });
    } catch (e) {
      pending.current = { ...body, ...pending.current };
      setState(e instanceof ApiError && e.code === "conflict" ? "conflict" : "error");
    }
  }, [id, qc, draftKey]);

  const schedule = (patch: typeof pending.current) => {
    pending.current = { ...pending.current, ...patch };
    setState("dirty");
    try {
      localStorage.setItem(draftKey, JSON.stringify({ ...pending.current, at: Date.now() }));
    } catch {}
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };

  // Ne jamais perdre une modification : envoi à la fermeture, avertissement si non enregistré.
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        e.preventDefault();
        flush();
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("beforeunload", before);
      flush();
    };
  }, [flush]);

  const setMeta = async (patch: Record<string, unknown>) => {
    try {
      await api.patch(`/api/notes/${id}`, patch);
      qc.invalidateQueries({ queryKey: ["note", id] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["note-tags"] });
      qc.invalidateQueries({ queryKey: ["note-folders"] });
    } catch (e) {
      toast({ kind: "error", title: "Modification non enregistrée", description: (e as Error).message });
    }
  };

  if (error) return <EmptyState title="Note introuvable" description={(error as Error).message} action={<Button onClick={onBack}>Retour</Button>} />;
  if (!note)
    return (
      <div className="mx-auto max-w-[760px] space-y-3 px-6 py-10">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-64" />
      </div>
    );

  const status = {
    saved: { icon: <Check className="size-3" />, label: "Enregistré", cls: "text-fg-3" },
    dirty: { icon: <Pencil className="size-3" />, label: "Modifications…", cls: "text-fg-3" },
    saving: { icon: <Loader2 className="size-3 animate-spin" />, label: "Enregistrement…", cls: "text-fg-3" },
    error: { icon: <AlertCircle className="size-3" />, label: "Échec — nouvel essai", cls: "text-danger" },
    conflict: { icon: <AlertCircle className="size-3" />, label: "Modifiée ailleurs", cls: "text-warning" },
  }[state];

  return (
    <div className="mx-auto max-w-[820px] px-4 py-5 md:px-10 md:py-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="size-4" />
        </Button>
        <span className={cn("t-meta inline-flex items-center gap-1.5", status.cls)} aria-live="polite">
          {status.icon}
          {status.label}
        </span>
        {state === "error" && (
          <Button size="sm" variant="ghost" onClick={flush}>
            Réessayer
          </Button>
        )}
        {state === "conflict" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              pending.current = {};
              qc.invalidateQueries({ queryKey: ["note", id] });
              window.location.reload();
            }}
          >
            Recharger la version serveur
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <NoteAiMenu note={note} getText={() => editorRef.current?.getText({ blockSeparator: "\n" }) ?? note.contentText} editor={editorRef} />
          <Button variant="ghost" size="icon-sm" onClick={() => setMeta({ favorite: !note.favorite })} aria-label={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}>
            <Star className={cn("size-4", note.favorite && "fill-warning text-warning")} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => (flush(), setHistoryOpen(true))} aria-label="Historique des versions">
            <History className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setConfirmDel(true)} aria-label="Supprimer la note">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          schedule({ title: e.target.value || "Sans titre" });
        }}
        placeholder="Sans titre"
        className="t-display mb-3 w-full bg-transparent placeholder:text-fg-3 focus:outline-none"
        aria-label="Titre de la note"
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Select value={note.folderId ?? ""} onChange={(e) => setMeta({ folderId: e.target.value || null })} className="h-7 w-auto text-[12px]">
          <option value="">Sans dossier</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        <Select value={note.projectId ?? ""} onChange={(e) => setMeta({ projectId: e.target.value || null })} className="h-7 w-auto text-[12px]" aria-label="Projet">
          <option value="">Aucun projet</option>
          {projects?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {note.projectId && <FolderKanban className="size-3.5 text-fg-3" />}
        {note.tags.map((t) => (
          <Badge key={t}>
            <Hash className="size-2.5" />
            {t}
            <button onClick={() => setMeta({ tags: note.tags.filter((x) => x !== t) })} aria-label={`Retirer ${t}`}>
              <X className="size-2.5" />
            </button>
          </Badge>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const t = tagInput.trim().replace(/^#/, "");
            if (t && !note.tags.includes(t)) setMeta({ tags: [...note.tags, t] });
            setTagInput("");
          }}
        >
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="+ étiquette" className="h-7 w-24 bg-transparent text-[12px] text-fg-2 placeholder:text-fg-3 focus:outline-none" />
        </form>
      </div>

      <NoteEditor
        content={note.content}
        onReady={(e) => (editorRef.current = e)}
        onChange={(json, text) => schedule({ content: json, contentText: text })}
      />

      <VersionHistory open={historyOpen} onClose={() => setHistoryOpen(false)} noteId={id} />
      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title="Supprimer cette note ?"
        description="La note et son historique de versions seront définitivement supprimés."
        danger
        confirmLabel="Supprimer"
        onConfirm={async () => {
          pending.current = {};
          try {
            await api.del(`/api/notes/${id}`);
            qc.invalidateQueries({ queryKey: ["notes"] });
            toast({ kind: "success", title: "Note supprimée" });
            onBack();
          } catch (e) {
            toast({ kind: "error", title: "Suppression impossible", description: (e as Error).message });
          }
        }}
      />
    </div>
  );
}

function VersionHistory({ open, onClose, noteId }: { open: boolean; onClose: () => void; noteId: string }) {
  const { data } = useQuery({ queryKey: ["note-versions", noteId], queryFn: () => api.get<{ items: { id: string; revision: number; title: string; createdAt: string }[] }>(`/api/notes/${noteId}/versions`), enabled: open });
  const [sel, setSel] = useState<string | null>(null);
  const { data: version } = useQuery({ queryKey: ["note-version", sel], queryFn: () => api.get<{ id: string; title: string; content: Record<string, unknown> }>(`/api/notes/${noteId}/versions/${sel}`), enabled: !!sel });
  const qc = useQueryClient();
  const { toast } = useToast();
  const preview = useMemo(() => {
    if (!version) return "";
    try {
      return generateText(version.content as never, noteExtensions(), { blockSeparator: "\n" });
    } catch {
      return "";
    }
  }, [version]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Historique des versions"
      description="Une version est conservée toutes les 5 minutes d'édition (50 maximum)."
      size="lg"
      footer={
        <Button
          variant="primary"
          disabled={!version}
          onClick={async () => {
            try {
              await api.post(`/api/notes/${noteId}/versions/${sel}`, { contentText: preview });
              toast({ kind: "success", title: "Version restaurée" });
              qc.invalidateQueries({ queryKey: ["notes"] });
              window.location.reload();
            } catch (e) {
              toast({ kind: "error", title: "Restauration impossible", description: (e as Error).message });
            }
          }}
        >
          Restaurer cette version
        </Button>
      }
    >
      <div className="grid gap-3 md:grid-cols-[200px_1fr]">
        <div className="max-h-80 overflow-y-auto">
          {data?.items.length === 0 && <p className="t-meta p-2">Aucune version antérieure pour l'instant.</p>}
          {data?.items.map((v) => (
            <button key={v.id} onClick={() => setSel(v.id)} className={cn("block w-full rounded-[7px] px-2.5 py-2 text-left", sel === v.id ? "bg-raised" : "hover:bg-raised/50")}>
              <span className="block truncate text-[13px]">{v.title}</span>
              <span className="t-meta">{new Date(v.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
            </button>
          ))}
        </div>
        <div className="max-h-80 overflow-y-auto rounded-[9px] border border-line-soft bg-bg-2 p-3 text-[13px] whitespace-pre-wrap text-fg-2">{version ? preview || "(vide)" : "Sélectionne une version pour la prévisualiser."}</div>
      </div>
    </Dialog>
  );
}
