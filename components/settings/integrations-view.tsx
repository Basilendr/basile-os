"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, CalendarDays, HardDrive, Users, Lightbulb, RefreshCw, Unplug, PlugZap, AlertTriangle, CheckCircle2, Circle, BrainCircuit } from "lucide-react";
import { api } from "@/lib/client/api";
import { relativeTime } from "@/lib/utils";
import { PageHeader, Card, Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { SchoolConnect } from "./school-connect";
import { MailConnect, useMailAccount } from "@/components/inbox/mail-box";

type Svc = { service: "gmail" | "calendar" | "drive" | "contacts"; status: string; accountEmail: string | null; lastSyncAt: string | null; lastError: string | null; scopes: string[] };
type Data = {
  google: { configured: boolean; redirectUri: string; account: string | null; grantedScopes: string[]; services: Svc[] };
  ai: { anthropic: boolean; openai: boolean; gemini: boolean; embeddings: { name: string; model: string } | null };
};

const META: Record<Svc["service"], { name: string; icon: React.ReactNode; desc: string; syncable: boolean; note?: string }> = {
  gmail: { name: "Gmail", icon: <Mail />, desc: "Lecture, recherche, libellés, brouillons et envoi (avec confirmation).", syncable: true },
  calendar: { name: "Google Calendar", icon: <CalendarDays />, desc: "Événements : lecture, création, modification, suppression, disponibilités.", syncable: true },
  drive: { name: "Google Drive", icon: <HardDrive />, desc: "Parcourir, rechercher, prévisualiser et importer tes documents Drive dans Fichiers.", syncable: false },
  contacts: { name: "Google Contacts", icon: <Users />, desc: "Accès en lecture prévu pour l'import du carnet d'adresses.", syncable: false, note: "Autorisation disponible ; l'import automatique n'est pas encore implémenté." },
};

export function IntegrationsView() {
  const { data, refetch } = useQuery({ queryKey: ["integrations"], queryFn: () => api.get<Data>("/api/integrations") });
  const sp = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [disconnect, setDisconnect] = useState<Svc["service"] | "all" | null>(null);

  useEffect(() => {
    const ok = sp.get("connected");
    const err = sp.get("error");
    if (ok) toast({ kind: "success", title: "Connexion Google réussie", description: ok.split(",").map((s) => META[s as Svc["service"]]?.name ?? s).join(", ") });
    if (err) toast({ kind: "error", title: "Connexion Google échouée", description: err });
    if (ok || err) router.replace("/integrations");
  }, [sp, toast, router]);

  const sync = async (service: "gmail" | "calendar") => {
    setBusy(service);
    try {
      await api.post("/api/integrations/google/sync", { service });
      toast({ kind: "success", title: "Synchronisation terminée" });
      ["integrations", "status", "events", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) {
      toast({ kind: "error", title: "Synchronisation échouée", description: (e as Error).message });
      refetch();
    } finally {
      setBusy(null);
    }
  };

  const g = data?.google;
  return (
    <div className="mx-auto max-w-[1100px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader title="Intégrations" description="Google (OAuth 2.0, sans mot de passe) et École Directe. Jetons et identifiants sont chiffrés sur le serveur et jamais renvoyés au navigateur." />

      <SchoolConnect />
      <MailCard />

      {g && !g.configured && (
        <Card className="mb-5 border-warning/30 p-4">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
            <div className="min-w-0 text-[13.5px]">
              <p className="font-medium">OAuth Google n'est pas encore configuré sur ce serveur</p>
              <p className="t-sub mt-1">
                Colle l'ID client et le code secret OAuth dans <b className="font-medium text-fg">Paramètres → Configuration</b> : aucune modification de fichier ni redémarrage n'est nécessaire. Le guide y indique l'URI de redirection à déclarer.
              </p>
              <a href="/settings?s=config" className="mt-3 inline-block">
                <Button size="sm" variant="primary">Ouvrir la configuration</Button>
              </a>
            </div>
          </div>
        </Card>
      )}

      {g?.account && (
        <p className="t-sub mb-3">
          Compte Google autorisé : <span className="text-fg">{g.account}</span>
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {(g?.services ?? []).map((s) => {
          const m = META[s.service];
          const connected = s.status === "connected";
          return (
            <Card key={s.service} className="flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-10 place-items-center rounded-[11px] border border-line bg-raised text-fg-2 [&>svg]:size-5">{m.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="t-section">{m.name}</h3>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="t-sub mt-1 text-[13px]">{m.desc}</p>
                </div>
              </div>
              <dl className="t-meta mt-3 grid gap-1">
                <div>Dernière synchronisation : {s.lastSyncAt ? relativeTime(s.lastSyncAt) : "jamais"}</div>
                <div className="break-all">Autorisations : {s.scopes.map((x) => x.replace("https://www.googleapis.com/auth/", "")).join(", ")}</div>
                {s.lastError && <div className="text-danger">Erreur : {s.lastError}</div>}
                {m.note && <div className="text-warning">{m.note}</div>}
              </dl>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                {connected ? (
                  <>
                    {m.syncable && (
                      <Button size="sm" icon={<RefreshCw className={busy === s.service ? "size-3.5 animate-spin" : "size-3.5"} />} disabled={!!busy} onClick={() => sync(s.service as "gmail" | "calendar")}>
                        Synchroniser
                      </Button>
                    )}
                    <a href={`/api/integrations/google/connect?services=${s.service}`}>
                      <Button size="sm" variant="ghost">
                        Reconnecter
                      </Button>
                    </a>
                    <Button size="sm" variant="ghost" icon={<Unplug className="size-3.5" />} onClick={() => setDisconnect(s.service)}>
                      Déconnecter
                    </Button>
                  </>
                ) : (
                  <a href={g?.configured ? `/api/integrations/google/connect?services=${s.service}` : undefined} aria-disabled={!g?.configured}>
                    <Button size="sm" variant="primary" disabled={!g?.configured} icon={<PlugZap className="size-3.5" />}>
                      {s.status === "error" ? "Reconnecter" : "Connecter"}
                    </Button>
                  </a>
                )}
              </div>
            </Card>
          );
        })}

        <Card className="flex flex-col p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-[11px] border border-line bg-raised text-fg-3">
              <Lightbulb className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="t-section">Fournisseur d'intelligence artificielle</h3>
                <StatusBadge status={data?.ai.anthropic || data?.ai.openai || data?.ai.gemini ? "connected" : "disconnected"} />
              </div>
              <p className="t-sub mt-1 text-[13px]">Assistant, agents, briefings, rédaction et classification. Les clés restent sur le serveur.</p>
            </div>
          </div>
          <dl className="t-meta mt-3 grid gap-1">
            <div>Anthropic (Claude) : {data?.ai.anthropic ? "clé configurée" : "aucune clé"}</div>
            <div>OpenAI : {data?.ai.openai ? "clé configurée" : "aucune clé"}</div>
            <div>Google Gemini : {data?.ai.gemini ? "clé configurée" : "aucune clé"}</div>
          </dl>
          <div className="mt-auto flex gap-2 pt-4">
            <a href="/settings?s=config">
              <Button size="sm" variant={data?.ai.anthropic || data?.ai.openai || data?.ai.gemini ? "secondary" : "primary"}>{data?.ai.anthropic || data?.ai.openai || data?.ai.gemini ? "Gérer les clés" : "Ajouter une clé"}</Button>
            </a>
            <a href="/settings?s=ai">
              <Button size="sm" variant="ghost">Modèle et permissions</Button>
            </a>
          </div>
        </Card>

        <Card className="flex flex-col p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-[11px] border border-line bg-raised text-fg-2">
              <BrainCircuit className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="t-section">Recherche sémantique (embeddings)</h3>
                <StatusBadge status={data?.ai.embeddings ? "connected" : "disconnected"} />
              </div>
              <p className="t-sub mt-1 text-[13px]">Recherche par le sens dans le Second Brain (pgvector).</p>
            </div>
          </div>
          <p className="t-meta mt-3">{data?.ai.embeddings ? `${data.ai.embeddings.name} · ${data.ai.embeddings.model}` : "Ajoute une clé Voyage (recommandé) ou OpenAI dans Paramètres → Configuration. Sans fournisseur, seule la recherche par mots-clés est disponible."}</p>
        </Card>
      </div>

      {g?.services.some((s) => s.status === "connected") && (
        <div className="mt-5 flex justify-end">
          <Button variant="danger" size="sm" onClick={() => setDisconnect("all")}>
            Révoquer tout l'accès Google
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={!!disconnect}
        onClose={() => setDisconnect(null)}
        danger
        title={disconnect === "all" ? "Révoquer l'accès Google ?" : `Déconnecter ${disconnect ? META[disconnect as Svc["service"]]?.name : ""} ?`}
        description={disconnect === "all" ? "Le jeton sera révoqué auprès de Google et supprimé de BASILE OS." : "BASILE OS cessera d'utiliser ce service. Si c'est le dernier service connecté, le jeton Google sera révoqué."}
        confirmLabel="Déconnecter"
        onConfirm={async () => {
          try {
            await api.post("/api/integrations/google/disconnect", { service: disconnect });
            toast({ kind: "success", title: "Déconnecté" });
            ["integrations", "status", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
          } catch (e) {
            toast({ kind: "error", title: "Déconnexion impossible", description: (e as Error).message });
          }
          setDisconnect(null);
        }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "connected")
    return (
      <Badge tone="success">
        <CheckCircle2 className="size-3" /> Connecté
      </Badge>
    );
  if (status === "error")
    return (
      <Badge tone="danger">
        <AlertTriangle className="size-3" /> Erreur
      </Badge>
    );
  return (
    <Badge>
      <Circle className="size-2.5" /> Non connecté
    </Badge>
  );
}

/** Adresse email classique (IMAP / SMTP), troisième boîte de la messagerie. */
function MailCard() {
  const { data } = useMailAccount();
  return (
    <Card id="email" className="mb-5 p-5">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-line bg-raised text-fg-2">
          <Mail className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="t-section">Autre adresse email</h3>
            <StatusBadge status={data?.status ?? "disconnected"} />
          </div>
          <p className="t-sub mt-1 text-[13px]">Orange, Free, SFR, iCloud, Yahoo, La Poste… lue en IMAP, envoi en SMTP. Synchronisation toutes les 10 minutes.</p>
        </div>
      </div>
      {data && <MailConnect account={data} compact />}
    </Card>
  );
}
