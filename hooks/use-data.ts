"use client";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api, qs } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast";
import type { Activity, CalendarEvent, NoteSummary, Project, Task, TaskCounts } from "@/types";

export type TaskView = "today" | "upcoming" | "all" | "overdue" | "done" | "project";

export function useTasks(params: { view?: TaskView; projectId?: string; q?: string } = {}) {
  return useQuery({
    queryKey: ["tasks", params],
    queryFn: () => api.get<{ items: Task[]; counts: TaskCounts }>(`/api/tasks${qs({ view: params.view ?? "all", projectId: params.projectId, q: params.q })}`),
  });
}

export function useProjects(opts: { archived?: boolean } = {}) {
  return useQuery({ queryKey: ["projects", opts], queryFn: () => api.get<{ items: Project[] }>(`/api/projects${opts.archived ? "?archived=1" : ""}`) });
}

export function useNotes(params: { folderId?: string; tag?: string; favorite?: boolean; q?: string; projectId?: string } = {}) {
  return useQuery({
    queryKey: ["notes", params],
    queryFn: () => api.get<{ items: NoteSummary[] }>(`/api/notes${qs({ folderId: params.folderId, tag: params.tag, favorite: params.favorite ? "1" : undefined, q: params.q, projectId: params.projectId })}`),
  });
}

export function useEvents(from: Date, to: Date) {
  return useQuery({
    queryKey: ["events", from.toISOString(), to.toISOString()],
    queryFn: () => api.get<{ items: CalendarEvent[] }>(`/api/events${qs({ from: from.toISOString(), to: to.toISOString() })}`),
  });
}

export function useActivity(limit = 30) {
  return useQuery({ queryKey: ["activity", limit], queryFn: () => api.get<{ items: Activity[] }>(`/api/activity?limit=${limit}`) });
}

/** Mutation avec invalidation des clés concernées et toast d'erreur explicite. */
export function useAction<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, opts: { invalidate?: QueryKey[]; success?: string | ((r: TRes) => string); onSuccess?: (r: TRes, v: TVars) => void } = {}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      qc.invalidateQueries({ queryKey: ["activity"] });
      if (opts.success) toast({ kind: "success", title: typeof opts.success === "function" ? opts.success(r) : opts.success });
      opts.onSuccess?.(r, v);
    },
    onError: (e) => toast({ kind: "error", title: "L'action a échoué", description: (e as Error).message }),
  });
}

/** Mise à jour optimiste d'une tâche dans toutes les listes en cache. */
export function useUpdateTask() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) => api.patch<Task>(`/api/tasks/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const snapshots = qc.getQueriesData<{ items: Task[] }>({ queryKey: ["tasks"] });
      for (const [key, data] of snapshots) {
        if (data?.items) qc.setQueryData(key, { ...data, items: data.items.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
      }
      return { snapshots };
    },
    onError: (e, _v, ctx) => {
      ctx?.snapshots.forEach(([k, d]) => qc.setQueryData(k, d));
      toast({ kind: "error", title: "Modification non enregistrée", description: (e as Error).message });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
