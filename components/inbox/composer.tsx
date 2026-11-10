"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { motion } from "motion/react";
import { X, Paperclip, Send, Bold, Italic, List, ListOrdered, Link2, Lightbulb, Minus, Maximize2, Upload, Check, Loader2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { AttachPicker } from "@/components/tasks/task-detail";

export type ComposeInit = { to?: string[]; cc?: string[]; bcc?: string[]; subject?: string; body?: string; threadId?: string; inReplyTo?: string; references?: string };

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Éditeur d'email : destinataires, mise en forme, pièces jointes, brouillon Gmail auto-enregistré, envoi confirmé. */
export function Composer({ init, onClose }: { init: ComposeInit; onClose: () => void }) {
  const [to, setTo] = useState<string[]>(init.to ?? []);
  const [cc, setCc] = useState<string[]>(init.cc ?? []);
  const [bcc, setBcc] = useState<string[]>(init.bcc ?? []);
  const [showCc, setShowCc] = useState(Boolean(init.cc?.length || init.bcc?.length));
  const [subject, setSubject] = useState(init.subject ?? "");
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState(false);
  const [min, setMin] = useState(false);
  const [improving, setImproving] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] } })],
    content: (init.body ?? "")
      .split("\n")
      .map((l) => `<p>${esc(l) || "<br>"}</p>`)
      .join(""),
    immediatelyRender: false,
    editorProps: { attributes: { class: "prose-os min-h-[220px] px-4 py-3 text-[14px]" } },
    onUpdate: () => touch(),
  });

  const payload = () => ({
    to,
    cc,
    bcc,
    subject,
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${editor?.getHTML() ?? ""}</div>`,
    text: editor?.getText({ blockSeparator: "\n" }) ?? "",
    threadId: init.threadId ?? null,
    inReplyTo: init.inReplyTo ?? null,
    references: init.references ?? null,
    fileIds: files.map((f) => f.id),
    draftId,
  });

  const saveDraft = async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setDraftState("saving");
    try {
      const r = await api.post<{ draftId: string }>("/api/gmail/drafts", payload());
      setDraftId(r.draftId);
      setDraftState("saved");
    } catch {
      setDraftState("error");
    }
  };
  function touch() {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(saveDraft, 2500);
  }
  useEffect(() => {
    touch();
  }, [to, cc, bcc, subject, files]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const send = async () => {
    setSending(true);
    if (timer.current) clearTimeout(timer.current);
    try {
      await api.post("/api/gmail/send", { ...payload(), confirm: true });
      toast({ kind: "success", title: "Email envoyé", description: "Confirmé par Gmail." });
      qc.invalidateQueries({ queryKey: ["gmail"] });
      onClose();
    } catch (e) {
      toast({ kind: "error", title: "Email non envoyé", description: (e as Error).message });
      setConfirm(false);
    } finally {
      setSending(false);
    }
  };

  const discard = async () => {
    if (timer.current) clearTimeout(timer.current);
    if (draftId) await api.del(`/api/gmail/drafts/${draftId}`).catch(() => null);
    onClose();
  };

  const uploadFiles = async (list: FileList) => {
    const fd = new FormData();
    [...list].forEach((f) => fd.append("file", f));
    try {
      const r = await fetch("/api/files/upload", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Import impossible");
      setFiles((x) => [...x, ...d.items.map((i: { id: string; name: string }) => ({ id: i.id, name: i.name }))]);
    } catch (e) {
      toast({ kind: "error", title: "Pièce jointe non ajoutée", description: (e as Error).message });
    }
  };

  const improve = async () => {
    const text = editor?.getText({ blockSeparator: "\n" }) ?? "";
    if (!text.trim()) return;
    setImproving(true);
    try {
      const r = await api.post<{ text: string }>("/api/ai/transform", { action: "improve", text, title: subject });
      editor?.commands.setContent(r.text.split("\n").map((l) => `<p>${esc(l) || "<br>"}</p>`).join(""), { emitUpdate: true });
    } catch (e) {
      toast({ kind: "error", title: "Amélioration impossible", description: (e as Error).message });
    } finally {
      setImproving(false);
    }
  };

  const valid = to.length > 0 && [...to, ...cc, ...bcc].every(isEmail);
  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div
      role="dialog"
      aria-label="Nouveau message"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}
      className={cn("fixed z-[78] flex flex-col overflow-hidden border border-line bg-card shadow-[var(--shadow-lg)]", min ? "right-4 bottom-4 h-12 w-[320px] rounded-[12px]" : "inset-0 md:inset-auto md:right-4 md:bottom-4 md:h-[min(640px,calc(100dvh-90px))] md:w-[600px] md:rounded-[14px]")}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-soft px-3">
        <span className="t-section flex-1 truncate">{subject || "Nouveau message"}</span>
        <span className="t-meta inline-flex items-center gap-1">
          {draftState === "saving" ? <Loader2 className="size-3 animate-spin" /> : draftState === "saved" ? <Check className="size-3" /> : null}
          {draftState === "saved" ? "Brouillon enregistré" : draftState === "error" ? "Brouillon non enregistré" : ""}
        </span>
        <button onClick={() => setMin((x) => !x)} className="grid size-7 place-items-center rounded-[7px] text-fg-3 hover:bg-raised hover:text-fg" aria-label={min ? "Agrandir" : "Réduire"}>
          {min ? <Maximize2 className="size-3.5" /> : <Minus className="size-3.5" />}
        </button>
        <button onClick={onClose} className="grid size-7 place-items-center rounded-[7px] text-fg-3 hover:bg-raised hover:text-fg" aria-label="Fermer (le brouillon est conservé)">
          <X className="size-4" />
        </button>
      </div>
      {!min && (
        <>
          <Recipients label="À" values={to} onChange={setTo} action={!showCc && <button className="t-meta hover:text-fg" onClick={() => setShowCc(true)}>Cc / Cci</button>} />
          {showCc && (
            <>
              <Recipients label="Cc" values={cc} onChange={setCc} />
              <Recipients label="Cci" values={bcc} onChange={setBcc} />
            </>
          )}
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Objet" className="h-10 border-b border-line-soft bg-transparent px-4 text-[14px] placeholder:text-fg-3 focus:outline-none" />
          <div className="flex items-center gap-0.5 border-b border-line-soft px-2 py-1">
            {[
              { l: "Gras", i: <Bold />, r: () => editor?.chain().focus().toggleBold().run(), a: editor?.isActive("bold") },
              { l: "Italique", i: <Italic />, r: () => editor?.chain().focus().toggleItalic().run(), a: editor?.isActive("italic") },
              { l: "Liste", i: <List />, r: () => editor?.chain().focus().toggleBulletList().run(), a: editor?.isActive("bulletList") },
              { l: "Liste numérotée", i: <ListOrdered />, r: () => editor?.chain().focus().toggleOrderedList().run(), a: editor?.isActive("orderedList") },
              {
                l: "Lien",
                i: <Link2 />,
                r: () => {
                  const u = window.prompt("Lien (https://…)");
                  if (u && /^(https?:|mailto:)/.test(u)) editor?.chain().focus().extendMarkRange("link").setLink({ href: u }).run();
                },
                a: editor?.isActive("link"),
              },
            ].map((b) => (
              <button key={b.l} onMouseDown={(e) => e.preventDefault()} onClick={b.r} title={b.l} aria-label={b.l} className={cn("grid size-7 place-items-center rounded-[6px] [&>svg]:size-3.5", b.a ? "bg-raised text-accent" : "text-fg-3 hover:bg-raised hover:text-fg")}>
                {b.i}
              </button>
            ))}
            <Button size="sm" variant="ghost" className="ml-auto" loading={improving} icon={<Lightbulb className="size-3.5 text-fg-3" />} onClick={improve}>
              Améliorer
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EditorContent editor={editor} />
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-line-soft px-3 py-2">
              {files.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1.5 rounded-[6px] border border-line px-2 py-1 text-[12px]">
                  <Paperclip className="size-3 text-fg-3" />
                  {f.name}
                  <button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label={`Retirer ${f.name}`}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-line-soft px-3 py-2.5">
            <Button variant="primary" icon={<Send className="size-3.5" />} disabled={!valid} onClick={() => setConfirm(true)}>
              Envoyer
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setPicker(true)} aria-label="Joindre depuis les fichiers" title="Joindre depuis les fichiers">
              <Paperclip className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => upload.current?.click()} aria-label="Importer une pièce jointe" title="Importer une pièce jointe">
              <Upload className="size-4" />
            </Button>
            <input ref={upload} type="file" multiple hidden onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
            <Button variant="ghost" className="ml-auto" onClick={discard}>
              Supprimer le brouillon
            </Button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        loading={sending}
        title="Envoyer cet email ?"
        description={
          <span>
            À : {to.join(", ")}
            {cc.length ? ` · Cc : ${cc.join(", ")}` : ""}
            {bcc.length ? ` · Cci : ${bcc.length}` : ""}
            <br />
            Objet : {subject || "(sans objet)"}
            {files.length ? ` · ${files.length} pièce(s) jointe(s)` : ""}
          </span>
        }
        confirmLabel="Envoyer"
        onConfirm={send}
      />
      <AttachPicker open={picker} onClose={() => setPicker(false)} onPick={(f) => (setFiles((x) => (x.some((y) => y.id === f.id) ? x : [...x, f])), setPicker(false))} />
    </motion.div>,
    document.body,
  );
}

function Recipients({ label, values, onChange, action }: { label: string; values: string[]; onChange: (v: string[]) => void; action?: React.ReactNode }) {
  const [text, setText] = useState("");
  const commit = () => {
    const parts = text.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...values, ...parts.filter((p) => !values.includes(p))]);
    setText("");
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 border-b border-line-soft px-4 py-1.5">
      <span className="t-meta w-8">{label}</span>
      {values.map((v) => (
        <span key={v} className={cn("inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[12.5px]", isEmail(v) ? "bg-raised" : "bg-danger/15 text-danger")}>
          {v}
          <button onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Retirer ${v}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (["Enter", ",", ";", "Tab"].includes(e.key) && text.trim()) {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={commit}
        className="h-7 min-w-[120px] flex-1 bg-transparent text-[13.5px] focus:outline-none"
        aria-label={`Destinataires ${label}`}
      />
      {action}
    </div>
  );
}
