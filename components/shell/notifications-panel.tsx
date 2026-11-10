"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Bell, BellOff, Check, CheckCheck, Mail, CalendarClock, AlarmClock, FolderKanban, Bot, Workflow, AlertTriangle, Trash2, Circle, Info, ListChecks } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import { Segmented } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/misc";

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  importance: string;
  readAt: string | null;
  createdAt: string;
};

export const NOTIF_ICONS: Record<string, typeof Bell> = {
  email: Mail,
  email_important: Mail,
  event_soon: CalendarClock,
  reminder: AlarmClock,
  deadline: AlarmClock,
  project: FolderKanban,
  agent: Bot,
  automation: Workflow,
  integration_error: AlertTriangle,
  quiz: ListChecks,
  system: Info,
};

export function useNotifications(filter: "all" | "unread" = "all", type?: string) {
  return useQuery({
    queryKey: ["notifications", filter, type],
    queryFn: () => api.get<{ items: Notification[]; unread: number }>(`/api/notifications?limit=100${filter === "unread" ? "&unread=1" : ""}${type ? `&type=${type}` : ""}`),
    refetchInterval: 45_000,
  });
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["status"] });
  };
  return {
    setRead: useMutation({ mutationFn: ({ id, read }: { id: string; read: boolean }) => api.patch(`/api/notifications/${id}`, { read }), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`/api/notifications/${id}`), onSuccess: invalidate }),
    readAll: useMutation({ mutationFn: () => api.post("/api/notifications/read-all"), onSuccess: invalidate }),
  };
}

export function NotificationRow({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const { setRead, remove } = useNotificationActions();
  const Icon = NOTIF_ICONS[n.type] ?? Bell;
  return (
    <div
      className={cn("group relative flex cursor-pointer gap-3 rounded-[9px] px-3 py-2.5 transition-colors hover:bg-raised", !n.readAt && "bg-raised/40")}
      onClick={() => onOpen(n)}
    >
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-[8px] border border-line",
          n.type === "integration_error" ? "text-danger" : n.importance === "high" ? "text-accent" : "text-fg-3",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[13px]", !n.readAt ? "font-medium text-fg" : "text-fg-2")}>{n.title}</p>
        {n.body && <p className="t-meta line-clamp-2">{n.body}</p>}
        <p className="t-meta mt-0.5">{relativeTime(n.createdAt)}</p>
      </div>
      {!n.readAt && <Circle className="mt-1.5 size-2 shrink-0 fill-accent text-accent group-hover:hidden" />}
      <div className="absolute top-2 right-2 hidden gap-0.5 rounded-[7px] border border-line bg-card p-0.5 group-hover:flex">
        <button
          className="grid size-6 place-items-center rounded-[5px] text-fg-3 hover:bg-raised hover:text-fg"
          title={n.readAt ? "Marquer comme non lu" : "Marquer comme lu"}
          onClick={(e) => (e.stopPropagation(), setRead.mutate({ id: n.id, read: !n.readAt }))}
        >
          {n.readAt ? <BellOff className="size-3.5" /> : <Check className="size-3.5" />}
        </button>
        <button
          className="grid size-6 place-items-center rounded-[5px] text-fg-3 hover:bg-raised hover:text-danger"
          title="Supprimer"
          onClick={(e) => (e.stopPropagation(), remove.mutate(n.id))}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function NotificationsPopover({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const { data } = useNotifications(filter);
  const { setRead, readAll } = useNotificationActions();
  const router = useRouter();
  const items = useMemo(() => data?.items.slice(0, 30) ?? [], [data]);

  const openItem = (n: Notification) => {
    if (!n.readAt) setRead.mutate({ id: n.id, read: true });
    if (n.href) {
      router.push(n.href);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={{ type: "spring", bounce: 0, visualDuration: 0.2 }}
            style={{ transformOrigin: "top right" }}
            className="fixed top-[76px] right-3 z-[61] flex max-h-[min(560px,calc(100dvh-96px))] w-[min(400px,calc(100vw-16px))] flex-col overflow-hidden rounded-[18px] border border-line bg-card shadow-[var(--shadow-lg)]"
          >
            <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3.5 py-2.5">
              <span className="t-section">Notifications</span>
              <div className="flex items-center gap-1.5">
                <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: "Toutes" }, { value: "unread", label: "Non lues", count: data?.unread }]} />
                <button className="grid size-7 place-items-center rounded-[7px] text-fg-3 hover:bg-raised hover:text-fg" title="Tout marquer comme lu" onClick={() => readAll.mutate()}>
                  <CheckCheck className="size-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {items.length === 0 ? (
                <EmptyState icon={<Bell className="size-5" />} title="Rien de nouveau" description="Les alertes, rappels et résultats d'automatisations apparaîtront ici." />
              ) : (
                items.map((n) => <NotificationRow key={n.id} n={n} onOpen={openItem} />)
              )}
            </div>
            <button
              onClick={() => (router.push("/notifications"), onClose())}
              className="border-t border-line-soft py-2.5 text-center text-[12.5px] font-medium text-fg-2 hover:bg-raised hover:text-fg"
            >
              Ouvrir le centre de notifications
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
