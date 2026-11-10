"use client";
import { useState, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { Lightbulb, ListChecks, FolderPlus, Languages, Wand2, SpellCheck, AlignLeft, Expand } from "lucide-react";
import { Menu } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/input";
import { Markdown } from "@/components/assistant/markdown";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { Note } from "@/types";

export type TransformAction = "summarize" | "rephrase" | "correct" | "expand" | "translate" | "extract_actions" | "extract_ideas" | "to_project" | "to_tasks";
type Result = { action: TransformAction; text?: string; items?: { title: string; detail?: string; dueDate?: string | null; priority?: string }[]; project?: { name: string; description: string } };

const LABELS: Record<TransformAction, string> = {
  summarize: "Résumer",
  rephrase: "Reformuler",
  correct: "Corriger",
  expand: "Développer",
  translate: "Traduire (FR ↔ EN)",
  extract_actions: "Extraire les actions",
  extract_ideas: "Extraire les idées",
  to_project: "Transformer en projet",
  to_tasks: "Transformer en tâches",
};

export function NoteAiMenu({ note, getText, editor }: { note: Note; getText: () => string; editor: MutableRefObject<Editor | null> }) {
  const [loading, setLoading] = useState<TransformAction | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();

  const run = async (action: TransformAction) => {
    const text = getText();
    if (!text.trim()) return toast({ kind: "info", title: "Note vide", description: "Écris d'abord quelque chose." });
    setLoading(action);
    try {
      const r = await api.post<Result>("/api/ai/transform", { action, text, title: note.title, sourceType: "note", sourceId: note.id });
      setResult(r);
      setPicked(new Set(r.items?.map((_, i) => i) ?? []));
    } catch (e) {
      toast({ kind: "error", title: `${LABELS[action]} : échec`, description: (e as Error).message });
    } finally {
      setLoading(null);
    }
  };

  const createTasks = async (projectId?: string) => {
    const items = result?.items?.filter((_, i) => picked.has(i)) ?? [];
    for (const it of items) await api.post("/api/tasks", { title: it.title, description: it.detail ?? "", dueDate: it.dueDate ?? null, priority: it.priority ?? "medium", projectId: projectId ?? note.projectId ?? null, sourceType: "note", sourceId: note.id });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    toast({ kind: "success", title: `${items.length} tâche${items.length > 1 ? "s" : ""} créée${items.length > 1 ? "s" : ""}` });
  };

  const icons: Record<TransformAction, React.ReactNode> = {
    summarize: <AlignLeft />,
    rephrase: <Wand2 />,
    correct: <SpellCheck />,
    expand: <Expand />,
    translate: <Languages />,
    extract_actions: <ListChecks />,
    extract_ideas: <Lightbulb />,
    to_project: <FolderPlus />,
    to_tasks: <ListChecks />,
  };

  return (
    <>
      <Menu
        trigger={({ toggle }) => (
          <Button variant="ghost" size="sm" loading={!!loading} icon={<Lightbulb className="size-3.5 text-fg-3" />} onClick={toggle}>
            {loading ? LABELS[loading] + "…" : "Outils"}
          </Button>
        )}
        items={[
          { type: "label", label: "Texte" },
          ...(["summarize", "rephrase", "correct", "expand", "translate"] as TransformAction[]).map((a) => ({ label: LABELS[a], icon: icons[a], onSelect: () => run(a) })),
          { type: "separator" },
          { type: "label", label: "Organiser" },
          ...(["extract_actions", "extract_ideas", "to_tasks", "to_project"] as TransformAction[]).map((a) => ({ label: LABELS[a], icon: icons[a], onSelect: () => run(a) })),
        ]}
      />
      <Dialog
        open={!!result}
        onClose={() => setResult(null)}
        title={result ? LABELS[result.action] : ""}
        description="Proposition de l'IA — rien n'est modifié sans ta validation."
        size="lg"
        footer={
          result && (
            <>
              <Button variant="ghost" onClick={() => setResult(null)}>
                Fermer
              </Button>
              {result.text && (
                <>
                  <Button onClick={() => (navigator.clipboard.writeText(result.text!), toast({ kind: "success", title: "Copié" }))}>Copier</Button>
                  <Button
                    onClick={() => {
                      editor.current?.chain().focus("end").insertContent(`<p></p><p>${escapeHtml(result.text!).replace(/\n/g, "<br>")}</p>`).run();
                      setResult(null);
                    }}
                  >
                    Insérer à la fin
                  </Button>
                  {["rephrase", "correct", "expand", "translate"].includes(result.action) && (
                    <Button
                      variant="primary"
                      onClick={() => {
                        editor.current?.commands.setContent(result.text!.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join(""), { emitUpdate: true });
                        setResult(null);
                      }}
                    >
                      Remplacer la note
                    </Button>
                  )}
                </>
              )}
              {result.items && result.action !== "extract_ideas" && result.action !== "to_project" && (
                <Button variant="primary" disabled={!picked.size} onClick={async () => (await createTasks(), setResult(null))}>
                  Créer {picked.size} tâche{picked.size > 1 ? "s" : ""}
                </Button>
              )}
              {result.action === "to_project" && result.project && (
                <Button
                  variant="primary"
                  onClick={async () => {
                    try {
                      const p = await api.post<{ id: string }>("/api/projects", { name: result.project!.name, description: result.project!.description });
                      await api.patch(`/api/notes/${note.id}`, { projectId: p.id });
                      await createTasks(p.id);
                      qc.invalidateQueries({ queryKey: ["projects"] });
                      setResult(null);
                      router.push(`/projects/${p.id}`);
                    } catch (e) {
                      toast({ kind: "error", title: "Projet non créé", description: (e as Error).message });
                    }
                  }}
                >
                  Créer le projet et {picked.size} tâche{picked.size > 1 ? "s" : ""}
                </Button>
              )}
            </>
          )
        }
      >
        {result?.project && (
          <div className="mb-3 rounded-[9px] border border-line-soft bg-bg-2 p-3">
            <p className="t-section">{result.project.name}</p>
            <p className="t-sub mt-1">{result.project.description}</p>
          </div>
        )}
        {result?.text && <Markdown content={result.text} />}
        {result?.items && (
          <ul className="flex flex-col gap-1">
            {result.items.map((it, i) => (
              <li key={i} className="flex items-start gap-2.5 rounded-[8px] px-2 py-2 hover:bg-raised/50">
                {result.action !== "extract_ideas" && (
                  <Checkbox
                    className="mt-0.5"
                    checked={picked.has(i)}
                    onChange={(v) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (v) n.add(i);
                        else n.delete(i);
                        return n;
                      })
                    }
                  />
                )}
                <div>
                  <p className="text-[13.5px]">{it.title}</p>
                  {it.detail && <p className="t-meta">{it.detail}</p>}
                  {it.dueDate && <p className="t-meta">Échéance : {it.dueDate}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
