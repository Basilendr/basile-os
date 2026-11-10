"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, GraduationCap, RefreshCw, ShieldQuestion, Unplug } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/misc";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { SchoolAccount } from "@/types";

type Report = { lessons: number; homework: number; grades: number; messages: number; newMessages: number; newGrades: number };

export function useSchoolAccount() {
  return useQuery({ queryKey: ["school", "account"], queryFn: () => api.get<SchoolAccount>("/api/school/account") });
}

const AUTO_SYNC_AFTER = 5 * 60_000;

/**
 * Synchronisation automatique, sans bouton : dès que BASILE OS est ouvert (et à chaque retour sur l'onglet),
 * si la dernière synchro date de plus de 5 minutes ; les écrans se mettent à jour tout seuls ensuite.
 */
export function SchoolAutoSync() {
  const qc = useQueryClient();
  const { data: account } = useQuery({ queryKey: ["school", "account"], queryFn: () => api.get<SchoolAccount>("/api/school/account"), refetchInterval: 60_000 });
  const running = useRef(false);
  const lastSeen = useRef<string | null>(null);
  const status = account?.status;
  const lastSyncAt = account && account.status !== "disconnected" ? account.lastSyncAt : null;

  // Une synchro faite par le serveur (toutes les 10 min) rafraîchit l'affichage.
  useEffect(() => {
    if (lastSyncAt && lastSeen.current && lastSyncAt !== lastSeen.current) qc.invalidateQueries({ queryKey: ["school"], predicate: (q) => q.queryKey[1] !== "account" });
    lastSeen.current = lastSyncAt;
  }, [lastSyncAt, qc]);

  useEffect(() => {
    if (status !== "connected" && status !== "error") return;
    const tick = () => {
      if (running.current || document.visibilityState !== "visible") return;
      if (lastSyncAt && Date.now() - new Date(lastSyncAt).getTime() < AUTO_SYNC_AFTER) return;
      running.current = true;
      api
        .post("/api/school/sync")
        .catch(() => {})
        .finally(() => {
          running.current = false;
          qc.invalidateQueries({ queryKey: ["school"] });
        });
    };
    tick();
    const t = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [status, lastSyncAt, qc]);
  return null;
}

/** Connexion École Directe : identifiants (chiffrés côté serveur), question de sécurité, synchronisation. */
export function SchoolConnect({ compact }: { compact?: boolean }) {
  const { data: account } = useSchoolAccount();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ username: "", password: "" });
  const [busy, setBusy] = useState<"login" | "qcm" | "sync" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);

  const refresh = () => ["school", "dashboard", "notifications"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const run = async <T,>(kind: "login" | "qcm" | "sync", fn: () => Promise<T>, ok?: (r: T) => void) => {
    setBusy(kind);
    try {
      const r = await fn();
      ok?.(r);
    } catch (e) {
      toast({ kind: "error", title: kind === "sync" ? "Synchronisation échouée" : "Connexion École Directe échouée", description: (e as Error).message });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const status = account?.status ?? "disconnected";
  return (
    <Card id="ecoledirecte" className={cn("mb-5 p-5", compact && "mb-0")}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-line bg-raised text-fg-2">
          <GraduationCap className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="t-section">École Directe</h3>
            {status === "connected" ? <Badge tone="success">Connecté</Badge> : status === "qcm_required" ? <Badge tone="warning">Vérification requise</Badge> : status === "error" ? <Badge tone="danger">Erreur</Badge> : <Badge>Non connecté</Badge>}
          </div>
          <p className="t-sub mt-1 text-[13px]">Emploi du temps, devoirs, évaluations, notes et messagerie. Synchronisation automatique, sans rien faire.</p>
        </div>
        {account && account.status !== "disconnected" && (
          <div className="flex gap-2">
            {account.status === "connected" && (
              <Button
                size="sm"
                icon={<RefreshCw className={cn("size-3.5", busy === "sync" && "animate-spin")} />}
                disabled={!!busy}
                onClick={() =>
                  run("sync", () => api.post<Report>("/api/school/sync"), (r) =>
                    toast({ kind: "success", title: "École Directe synchronisé", description: `${r.lessons} cours, ${r.homework} devoirs, ${r.grades} notes, ${r.messages} messages` }),
                  )
                }
              >
                Synchroniser
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Unplug className="size-3.5" />} onClick={() => setConfirm(true)}>
              Déconnecter
            </Button>
          </div>
        )}
      </div>

      {account && account.status !== "disconnected" && (
        <dl className="t-meta mt-3 grid gap-1 pl-[52px]">
          <div>
            Compte : <span className="text-fg-2">{account.studentName ?? account.username}</span>
            {account.className ? ` · ${account.className}` : ""}
            {account.schoolName ? ` · ${account.schoolName}` : ""}
          </div>
          <div>Dernière synchronisation : {account.lastSyncAt ? relativeTime(account.lastSyncAt) : "jamais"}</div>
          {account.lastError && (
            <div className="flex items-center gap-1.5 text-danger">
              <AlertTriangle className="size-3.5" />
              {account.lastError}
            </div>
          )}
        </dl>
      )}

      {account?.status === "qcm_required" && account.qcm && (
        <div className="mt-4 rounded-[14px] border border-line bg-bg p-4 sm:ml-[52px]">
          <p className="flex items-center gap-2 text-[13.5px] font-medium">
            <ShieldQuestion className="size-4 text-accent" />
            Question de sécurité École Directe
          </p>
          <p className="t-sub mt-1">{account.qcm.question}</p>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {account.qcm.propositions.map((p) => (
              <button
                key={p.index}
                onClick={() => setChoice(p.index)}
                className={cn("focus-ring rounded-[10px] border px-3 py-2 text-left text-[13px] transition-colors", choice === p.index ? "border-accent bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] font-medium" : "border-line bg-card hover:border-fg-3/40")}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={choice === null}
              loading={busy === "qcm"}
              onClick={() =>
                run("qcm", () => api.post<SchoolAccount>("/api/school/account/qcm", { index: choice }), (r) => {
                  setChoice(null);
                  if (r.status === "connected") toast({ kind: "success", title: "École Directe connecté", description: "Première synchronisation en cours…" });
                })
              }
            >
              Valider la réponse
            </Button>
          </div>
        </div>
      )}

      {(status === "disconnected" || status === "error") && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:pl-[52px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.username || !form.password) return;
            run("login", () => api.post<SchoolAccount>("/api/school/account", form), (r) => {
              setForm({ username: "", password: "" });
              if (r.status === "connected") toast({ kind: "success", title: "École Directe connecté", description: "Première synchronisation en cours…" });
              if (r.status === "qcm_required") toast({ kind: "info", title: "Une vérification est demandée", description: "Réponds à la question de sécurité." });
            });
          }}
        >
          <Field label="Identifiant École Directe">
            <Input name="ed-identifiant" autoComplete="off" data-1p-ignore data-lpignore="true" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Mot de passe">
            <Input type="password" name="ed-motdepasse" autoComplete="new-password" data-1p-ignore data-lpignore="true" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Button type="submit" variant="primary" loading={busy === "login"} disabled={!form.username || !form.password}>
            Connecter
          </Button>
          <p className="t-meta sm:col-span-3">
            Le mot de passe est chiffré (AES-256-GCM) et sert uniquement à renouveler la session École Directe. API non officielle : un changement côté École Directe peut interrompre la synchronisation ; la saisie manuelle reste disponible.
          </p>
        </form>
      )}

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        danger
        title="Déconnecter École Directe ?"
        description="Les identifiants chiffrés et les données importées d'École Directe (cours, devoirs, notes, messages) sont supprimés de BASILE OS. Tes ajouts manuels sont conservés."
        confirmLabel="Déconnecter"
        onConfirm={async () => {
          await api.del("/api/school/account").catch((e) => toast({ kind: "error", title: "Déconnexion impossible", description: (e as Error).message }));
          setConfirm(false);
          refresh();
        }}
      />
    </Card>
  );
}

