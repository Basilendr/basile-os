"use client";
import { MessageSquare, CheckSquare, CalendarPlus, NotebookPen, Mail, FolderPlus, Workflow, Upload } from "lucide-react";
import { WidgetCard } from "./widgets";
import { useUI, type CreateKind } from "@/components/shell/ui-context";

export function QuickActions() {
  const { openCreate, setAssistantOpen } = useUI();
  const actions: { label: string; icon: React.ReactNode; run: () => void }[] = [
    { label: "Nouvelle tâche", icon: <CheckSquare />, run: () => openCreate("task") },
    { label: "Nouvel événement", icon: <CalendarPlus />, run: () => openCreate("event") },
    { label: "Nouvelle note", icon: <NotebookPen />, run: () => openCreate("note") },
    { label: "Rédiger un email", icon: <Mail />, run: () => openCreate("email") },
    { label: "Créer un projet", icon: <FolderPlus />, run: () => openCreate("project") },
    { label: "Assistant", icon: <MessageSquare />, run: () => setAssistantOpen(true) },
    { label: "Automatisation", icon: <Workflow />, run: () => openCreate("automation" as CreateKind) },
    { label: "Ajouter un fichier", icon: <Upload />, run: () => openCreate("file") },
  ];
  return (
    <WidgetCard title="Actions rapides" subtitle="Créer en un clic">
      <div className="grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.run}
            className="focus-ring flex h-10 items-center gap-2.5 rounded-[11px] border border-line-soft bg-bg px-3 text-left text-[12.5px] font-medium text-fg-2 transition-[transform,background-color,color] duration-100 hover:bg-raised hover:text-fg active:scale-[0.98] [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-3"
          >
            {a.icon}
            <span className="truncate">{a.label}</span>
          </button>
        ))}
      </div>
    </WidgetCard>
  );
}
