"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Settings2 } from "lucide-react";
import { PageHeader, EmptyState, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, Switch } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast";
import { NotificationRow, useNotificationActions, useNotifications, type Notification } from "./notifications-panel";

export const NOTIF_TYPES: Record<string, string> = {
  email: "Nouveaux emails",
  email_important: "Emails importants",
  event_soon: "Événements imminents",
  reminder: "Rappels",
  deadline: "Échéances",
  project: "Alertes de projet",
  agent: "Activité des agents IA",
  automation: "Résultats des automatisations",
  integration_error: "Erreurs d'intégration",
  quiz: "Quiz de révision",
  system: "Système",
};

export function NotificationsCenter() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [type, setType] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const { data, isLoading } = useNotifications(filter, type || undefined);
  const { setRead, readAll } = useNotificationActions();
  const router = useRouter();
  const open = (n: Notification) => {
    if (!n.readAt) setRead.mutate({ id: n.id, read: true });
    if (n.href) router.push(n.href);
  };
  return (
    <div className="mx-auto max-w-[860px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader
        title="Notifications"
        description={data ? `${data.unread} non lue${data.unread > 1 ? "s" : ""}` : " "}
        actions={
          <>
            <Button size="sm" icon={<CheckCheck className="size-3.5" />} onClick={() => readAll.mutate()}>
              Tout marquer comme lu
            </Button>
            <Button size="sm" variant="ghost" icon={<Settings2 className="size-3.5" />} onClick={() => setPrefsOpen(true)}>
              Préférences
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "Toutes" }, { value: "unread", label: "Non lues", count: data?.unread }]} />
          <Select value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Filtrer par type">
            <option value="">Tous les types</option>
            {Object.entries(NOTIF_TYPES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </div>
      </PageHeader>
      <div className="surface p-1.5">
        {isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="m-2 h-12" />)
        ) : !data?.items.length ? (
          <EmptyState icon={<Bell className="size-5" />} title="Aucune notification" description="Les rappels, échéances, emails importants et résultats d'automatisations s'afficheront ici." />
        ) : (
          data.items.map((n) => <NotificationRow key={n.id} n={n} onOpen={open} />)
        )}
      </div>
      <NotificationPrefs open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}

export function NotificationPrefs({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ["preferences"], queryFn: () => api.get<{ notificationPrefs: Record<string, boolean> }>("/api/preferences"), enabled: open });
  const qc = useQueryClient();
  const { toast } = useToast();
  const prefs = data?.notificationPrefs ?? {};
  const set = async (k: string, v: boolean) => {
    try {
      await api.patch("/api/preferences", { notificationPrefs: { ...prefs, [k]: v } });
      qc.invalidateQueries({ queryKey: ["preferences"] });
    } catch (e) {
      toast({ kind: "error", title: "Préférence non enregistrée", description: (e as Error).message });
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Préférences de notification" description="Choisis les types d'alertes que BASILE OS peut créer.">
      <div className="flex flex-col divide-y divide-line-soft">
        {Object.entries(NOTIF_TYPES).map(([k, l]) => (
          <label key={k} className="flex items-center justify-between py-2.5 text-[13.5px]">
            {l}
            <Switch checked={prefs[k] !== false} onChange={(v) => set(k, v)} label={l} />
          </label>
        ))}
      </div>
    </Dialog>
  );
}
