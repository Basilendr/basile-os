"use client";
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, Quote, Code2, Table, Image as ImageIcon, Link2, Minus, Undo2, Redo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { noteExtensions } from "./extensions";
import { useToast } from "@/components/ui/toast";

export function NoteEditor({ content, onChange, editable = true, onReady }: { content: Record<string, unknown>; onChange: (json: Record<string, unknown>, text: string) => void; editable?: boolean; onReady?: (e: Editor) => void }) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const editor = useEditor({
    extensions: noteExtensions(),
    content: content && Object.keys(content).length ? content : undefined,
    editable,
    immediatelyRender: false,
    editorProps: { attributes: { class: "prose-os min-h-[50vh] pb-24" } },
    onUpdate: ({ editor }) => cb.current(editor.getJSON() as Record<string, unknown>, editor.getText({ blockSeparator: "\n" })),
  });
  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);
  if (!editor) return <div className="min-h-[50vh]" />;
  return (
    <div>
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const { toast } = useToast();
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    editor.on("selectionUpdate", f);
    editor.on("transaction", f);
    return () => {
      editor.off("selectionUpdate", f);
      editor.off("transaction", f);
    };
  }, [editor]);
  const file = useRef<HTMLInputElement>(null);
  const c = () => editor.chain().focus();
  const btn = (label: string, icon: React.ReactNode, run: () => void, active = false) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn("grid size-7 shrink-0 place-items-center rounded-[6px] transition-colors [&>svg]:size-3.5", active ? "bg-raised text-accent" : "text-fg-3 hover:bg-raised hover:text-fg")}
    >
      {icon}
    </button>
  );
  const sep = (k: string) => <span key={k} className="mx-1 h-4 w-px shrink-0 bg-line" />;
  const uploadImage = async (f: File) => {
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await fetch("/api/files/upload", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Échec de l'import");
      c().setImage({ src: `/api/files/${d.items[0].id}/content`, alt: f.name }).run();
    } catch (e) {
      toast({ kind: "error", title: "Image non importée", description: (e as Error).message });
    }
  };
  return (
    <div className="glass sticky top-0 z-10 -mx-1 mb-4 flex items-center gap-0.5 overflow-x-auto rounded-[9px] border border-line-soft px-1 py-1">
      {btn("Annuler", <Undo2 />, () => c().undo().run())}
      {btn("Rétablir", <Redo2 />, () => c().redo().run())}
      {sep("s0")}
      {btn("Titre 1", <Heading1 />, () => c().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }))}
      {btn("Titre 2", <Heading2 />, () => c().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
      {btn("Titre 3", <Heading3 />, () => c().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}
      {sep("s1")}
      {btn("Gras", <Bold />, () => c().toggleBold().run(), editor.isActive("bold"))}
      {btn("Italique", <Italic />, () => c().toggleItalic().run(), editor.isActive("italic"))}
      {btn("Barré", <Strikethrough />, () => c().toggleStrike().run(), editor.isActive("strike"))}
      {btn("Code", <Code />, () => c().toggleCode().run(), editor.isActive("code"))}
      {btn("Lien", <Link2 />, () => {
        const prev = editor.getAttributes("link").href as string | undefined;
        const url = window.prompt("Adresse du lien (https://…)", prev ?? "https://");
        if (url === null) return;
        if (!url) c().unsetLink().run();
        else if (/^(https?:|mailto:)/.test(url)) c().extendMarkRange("link").setLink({ href: url }).run();
        else toast({ kind: "error", title: "Lien refusé", description: "Seuls les liens http(s) et mailto sont autorisés." });
      }, editor.isActive("link"))}
      {sep("s2")}
      {btn("Liste", <List />, () => c().toggleBulletList().run(), editor.isActive("bulletList"))}
      {btn("Liste numérotée", <ListOrdered />, () => c().toggleOrderedList().run(), editor.isActive("orderedList"))}
      {btn("Checklist", <ListChecks />, () => c().toggleTaskList().run(), editor.isActive("taskList"))}
      {btn("Citation", <Quote />, () => c().toggleBlockquote().run(), editor.isActive("blockquote"))}
      {btn("Bloc de code", <Code2 />, () => c().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
      {btn("Séparateur", <Minus />, () => c().setHorizontalRule().run())}
      {sep("s3")}
      {btn("Tableau", <Table />, () => (editor.isActive("table") ? c().addRowAfter().run() : c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()), editor.isActive("table"))}
      {btn("Image", <ImageIcon />, () => file.current?.click())}
      <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
    </div>
  );
}
