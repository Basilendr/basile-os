"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import { api, ApiError } from "@/lib/client/api";
import { TaskForm, emptyTask, toTaskPayload, type TaskFormValue } from "./task-form";
import { ProjectForm, emptyProject, toProjectPayload, type ProjectFormValue } from "./project-form";
import { EventForm, emptyEvent, toEventPayload, type EventFormValue } from "./event-form";
import type { Note, Project, Task } from "@/types";

/** Fenêtres de création rapide, accessibles depuis toute l'application. */
export function CreateDialogs() {
  const { create, closeCreate } = useUI();
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Redirections pour les créations qui ont leur propre éditeur
  useEffect(() => {
    if (!create) return;
    const redirects: Partial<Record<string, string>> = { email: "/inbox?compose=1", automation: "/automations?new=1", file: "/files?upload=1", contact: "/contacts?new=1", transaction: "/finance?new=1" };
    const href = redirects[create.kind];
    if (href) {
      closeCreate();
      router.push(href);
    }
    if (create.kind === "note") {
      closeCreate();
      api
        .post<Note>("/api/notes", { title: "Sans titre", ...(create.defaults ?? {}) })
        .then((n) => {
          qc.invalidateQueries({ queryKey: ["notes"] });
          router.push(`/notes?note=${n.id}`);
        })
        .catch((e) => toast({ kind: "error", title: "Création impossible", description: (e as Error).message }));
    }
  }, [create, closeCreate, router, qc, toast]);

  return (
    <>
      <CreateTask open={create?.kind === "task"} defaults={create?.kind === "task" ? create.defaults : undefined} onClose={closeCreate} />
      <CreateProject open={create?.kind === "project"} onClose={closeCreate} />
      <CreateEvent open={create?.kind === "event"} defaults={create?.kind === "event" ? create.defaults : undefined} onClose={closeCreate} />
    </>
  );
}

function useSubmit<T>(fn: () => Promise<T>, done: (r: T) => void) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const { toast } = useToast();
  const run = async () => {
    setLoading(true);
    setErrors({});
    try {
      done(await fn());
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(e.issues);
      toast({ kind: "error", title: "Enregistrement impossible", description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };
  return { loading, errors, run };
}

function CreateTask({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: Record<string, unknown> }) {
  const [v, setV] = useState<TaskFormValue>(emptyTask());
  const qc = useQueryClient();
  const { toast } = useToast();
  useEffect(() => {
    if (open) setV(emptyTask(defaults as Partial<TaskFormValue>));
  }, [open, defaults]);
  const { loading, errors, run } = useSubmit(
    () => api.post<Task>("/api/tasks", { ...toTaskPayload(v), subtasks: v.subtasks, sourceType: defaults?.sourceType, sourceId: defaults?.sourceId }),
    (t) => {
      ["tasks", "projects", "project", "dashboard", "activity"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast({ kind: "success", title: "Tâche créée", description: t.title });
      onClose();
    },
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouvelle tâche"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={run} loading={loading} disabled={!v.title.trim()}>
            Créer la tâche
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (v.title.trim()) run();
        }}
      >
        <TaskForm value={v} onChange={setV} errors={errors} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function CreateProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [v, setV] = useState<ProjectFormValue>(emptyProject());
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  useEffect(() => {
    if (open) setV(emptyProject());
  }, [open]);
  const { loading, errors, run } = useSubmit(
    () => api.post<Project>("/api/projects", toProjectPayload(v)),
    (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ kind: "success", title: "Projet créé", description: p.name });
      onClose();
      router.push(`/projects/${p.id}`);
    },
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouveau projet"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={run} loading={loading} disabled={!v.name.trim()}>
            Créer le projet
          </Button>
        </>
      }
    >
      <ProjectForm value={v} onChange={setV} errors={errors} />
    </Dialog>
  );
}

function CreateEvent({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: Record<string, unknown> }) {
  const [v, setV] = useState<EventFormValue>(emptyEvent());
  const qc = useQueryClient();
  const { toast } = useToast();
  useEffect(() => {
    if (open) setV(emptyEvent(defaults as Partial<EventFormValue>));
  }, [open, defaults]);
  const { loading, errors, run } = useSubmit(
    () => api.post<{ title: string; source: string }>("/api/events", toEventPayload(v)),
    (e) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ kind: "success", title: e.source === "google" ? "Événement créé dans Google Calendar" : "Événement créé", description: e.title });
      onClose();
    },
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouvel événement"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={run} loading={loading} disabled={!v.title.trim()}>
            Créer l'événement
          </Button>
        </>
      }
    >
      <EventForm value={v} onChange={setV} errors={errors} />
    </Dialog>
  );
}
