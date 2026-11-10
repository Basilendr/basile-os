"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User, Palette, Lightbulb, Plug, Lock, ShieldCheck, Trash2, Download, Plus, Pencil, Monitor, KeyRound } from "lucide-react";
import { ConfigSection, WeatherSection } from "./config-section";
import { api } from "@/lib/client/api";
import { MEMORY_CATEGORIES, TOOLS, ALWAYS_CONFIRM, AI_MODELS, defaultToolPolicy, type ToolName } from "@/lib/catalog";
import { cn, relativeTime } from "@/lib/utils";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui/misc";
import { Field, Input, Select, Switch, Checkbox } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

type Section = "general" | "config" | "appearance" | "ai" | "integrations" | "privacy" | "security";
type Me = { email: string; profile: { displayName: string; avatarUrl: string | null; locale: string; timezone: string; dateFormat: string; timeFormat: string }; prefs: Prefs };
type Prefs = { theme: string; accent: string; density: string; sidebarCollapsed: boolean; aiProvider: string; aiModel: string; memoryEnabled: boolean; memoryCategories: string[]; toolPermissions: Record<string, "allow" | "confirm" | "deny"> };

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "Général", icon: <User /> },
  { id: "config", label: "Configuration", icon: <KeyRound /> },
  { id: "appearance", label: "Apparence", icon: <Palette /> },
  { id: "ai", label: "Intelligence artificielle", icon: <Lightbulb /> },
  { id: "integrations", label: "Intégrations", icon: <Plug /> },
  { id: "privacy", label: "Confidentialité", icon: <Lock /> },
  { id: "security", label: "Sécurité", icon: <ShieldCheck /> },
];

export function SettingsView() {
  const sp = useSearchParams();
  const router = useRouter();
  const section = (sp.get("s") as Section) || "general";
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/auth/me") });
  return (
    <div className="mx-auto max-w-[1100px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader title="Paramètres" />
      <div className="grid gap-6 md:grid-cols-[210px_1fr]">
        <nav className="-mx-1 flex gap-1 overflow-x-auto md:mx-0 md:flex-col">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => router.replace(`/settings?s=${s.id}`, { scroll: false })}
              className={cn("flex h-9 shrink-0 items-center gap-2.5 rounded-[8px] px-3 text-[13px] [&>svg]:size-4", section === s.id ? "bg-raised text-fg [&>svg]:text-accent" : "text-fg-2 hover:bg-raised/50 [&>svg]:text-fg-3")}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {!me ? null : section === "general" ? (
            <>
              <General me={me} />
              <WeatherSection />
            </>
          ) : section === "config" ? (
            <ConfigSection />
          ) : section === "appearance" ? (
            <Appearance prefs={me.prefs} />
          ) : section === "ai" ? (
            <AiSettings prefs={me.prefs} />
          ) : section === "integrations" ? (
            <Card className="p-5">
              <p className="t-sub">Connexions Google (Gmail, Agenda, Drive, Contacts) et École Directe.</p>
              <Link href="/integrations" className="mt-3 inline-block">
                <Button variant="primary">Ouvrir le centre d'intégrations</Button>
              </Link>
            </Card>
          ) : section === "privacy" ? (
            <Privacy prefs={me.prefs} />
          ) : (
            <Security />
          )}
        </div>
      </div>
    </div>
  );
}

function usePatch(url: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return async (body: Record<string, unknown>, opts: { reload?: boolean; silent?: boolean } = {}) => {
    try {
      await api.patch(url, body);
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["preferences"] });
      qc.invalidateQueries({ queryKey: ["status"] });
      if (!opts.silent) toast({ kind: "success", title: "Enregistré" });
      if (opts.reload) window.location.reload();
    } catch (e) {
      toast({ kind: "error", title: "Non enregistré", description: (e as Error).message });
    }
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="mb-4 p-5">
      <h2 className="t-section">{title}</h2>
      {description && <p className="t-sub mt-1 mb-4">{description}</p>}
      {!description && <div className="mb-4" />}
      {children}
    </Card>
  );
}

function General({ me }: { me: Me }) {
  const save = usePatch("/api/profile");
  const [v, setV] = useState(me.profile);
  const tzs = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [me.profile.timezone];
  return (
    <Section title="Profil" description={`Compte : ${me.email}`}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Nom">
          <Input value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />
        </Field>
        <Field label="Avatar (URL d'image)" hint="Optionnel">
          <Input value={v.avatarUrl ?? ""} onChange={(e) => setV({ ...v, avatarUrl: e.target.value || null })} placeholder="https://…" />
        </Field>
        <Field label="Langue">
          <Select value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value })}>
            <option value="fr">Français</option>
            <option value="en">English (réponses de l'IA)</option>
          </Select>
        </Field>
        <Field label="Fuseau horaire">
          <Select value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
            {tzs.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Format de date">
          <Select value={v.dateFormat} onChange={(e) => setV({ ...v, dateFormat: e.target.value })}>
            <option value="dd/MM/yyyy">31/12/2026</option>
            <option value="yyyy-MM-dd">2026-12-31</option>
            <option value="MM/dd/yyyy">12/31/2026</option>
          </Select>
        </Field>
        <Field label="Format horaire">
          <Select value={v.timeFormat} onChange={(e) => setV({ ...v, timeFormat: e.target.value })}>
            <option value="24h">24 h</option>
            <option value="12h">12 h</option>
          </Select>
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" onClick={() => save({ ...v, avatarUrl: v.avatarUrl?.trim() || null }, { reload: v.displayName !== me.profile.displayName || v.avatarUrl !== me.profile.avatarUrl })}>
          Enregistrer
        </Button>
      </div>
    </Section>
  );
}

const ACCENTS = ["#0071E3", "#1D1D1F", "#34C759", "#FF9500", "#AF52DE", "#FF2D55"];

function Appearance({ prefs }: { prefs: Prefs }) {
  const save = usePatch("/api/preferences");
  const apply = (p: Partial<Prefs>) => {
    const html = document.documentElement;
    if (p.theme) html.dataset.theme = p.theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : p.theme;
    if (p.density) html.dataset.density = p.density;
    if (p.accent) html.style.setProperty("--accent", p.accent);
    save(p, { silent: true });
  };
  return (
    <>
      <Section title="Thème">
        <div className="grid grid-cols-3 gap-2">
          {[
            { v: "dark", l: "Sombre" },
            { v: "light", l: "Clair" },
            { v: "system", l: "Système" },
          ].map((t) => (
            <button key={t.v} onClick={() => apply({ theme: t.v })} className={cn("flex flex-col items-center gap-2 rounded-[10px] border p-3 text-[13px]", prefs.theme === t.v ? "border-accent bg-accent/5" : "border-line hover:border-fg-3/40")}>
              <span className={cn("h-10 w-full rounded-[6px] border border-line", t.v === "dark" ? "bg-[#09090B]" : t.v === "light" ? "bg-[#fafafa]" : "bg-gradient-to-r from-[#09090B] to-[#fafafa]")} />
              {t.l}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Couleur d'accent">
        <div className="flex gap-2">
          {ACCENTS.map((c) => (
            <button key={c} onClick={() => apply({ accent: c })} className={cn("size-8 rounded-full border-2 transition-transform active:scale-90", prefs.accent.toLowerCase() === c.toLowerCase() ? "border-fg" : "border-transparent")} style={{ background: c }} aria-label={c} />
          ))}
        </div>
      </Section>
      <Section title="Densité et navigation">
        <div className="flex flex-col gap-3">
          <label className="flex items-center justify-between text-[13.5px]">
            Interface compacte
            <Switch checked={prefs.density === "compact"} onChange={(v) => apply({ density: v ? "compact" : "comfortable" })} />
          </label>
          <label className="flex items-center justify-between text-[13.5px]">
            Barre latérale réduite par défaut
            <Switch checked={prefs.sidebarCollapsed} onChange={(v) => (localStorage.removeItem("bos.sidebar"), save({ sidebarCollapsed: v }, { reload: true }))} />
          </label>
          <p className="t-meta">
            Disposition du tableau de bord : utilise « Personnaliser » sur la <Link href="/" className="text-accent">vue d'ensemble</Link>.
          </p>
        </div>
      </Section>
    </>
  );
}

const MODELS: Record<string, string[]> = Object.fromEntries(Object.entries(AI_MODELS).map(([k, v]) => [k, v.map((m) => m.id)]));

function AiSettings({ prefs }: { prefs: Prefs }) {
  const save = usePatch("/api/preferences");
  const { data: usage } = useQuery({ queryKey: ["ai-usage"], queryFn: () => api.get<{ last30Days: { model: string; feature: string; calls: number; input: number; output: number }[] }>("/api/ai/usage") });
  const [perms, setPerms] = useState(prefs.toolPermissions);
  const totals = usage?.last30Days.reduce((a, r) => ({ calls: a.calls + r.calls, input: a.input + r.input, output: a.output + r.output }), { calls: 0, input: 0, output: 0 });
  return (
    <>
      <Section title="Fournisseur et modèle" description="Les clés API se règlent dans Paramètres → Configuration ; elles restent chiffrées sur le serveur.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fournisseur">
            <Select value={prefs.aiProvider} onChange={(e) => save({ aiProvider: e.target.value, aiModel: MODELS[e.target.value][0] })}>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (ChatGPT)</option>
              <option value="gemini">Google Gemini (offre gratuite)</option>
            </Select>
          </Field>
          <Field label="Modèle">
            <Select value={prefs.aiModel} onChange={(e) => save({ aiModel: e.target.value })}>
              {MODELS[prefs.aiProvider]?.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>
      <Section title="Permissions des outils" description="Autoriser : l'IA agit directement. Confirmer : l'IA prépare, tu valides. Interdire : outil indisponible. L'envoi d'emails et la modification du calendrier exigent toujours une confirmation.">
        <div className="flex flex-col divide-y divide-line-soft">
          {(Object.keys(TOOLS) as ToolName[]).map((t) => {
            const locked = ALWAYS_CONFIRM.includes(t);
            const value = perms[t] ?? defaultToolPolicy(t);
            return (
              <div key={t} className="flex items-center gap-3 py-2">
                <span className="flex-1 text-[13px]">
                  {TOOLS[t].label}
                  <span className="t-meta ml-2">{{ read: "lecture", write: "écriture", external: "externe" }[TOOLS[t].sensitivity]}</span>
                </span>
                <Select
                  value={locked && value === "allow" ? "confirm" : value}
                  onChange={(e) => {
                    const next = { ...perms, [t]: e.target.value as "allow" };
                    setPerms(next);
                    save({ toolPermissions: next }, { silent: true });
                  }}
                  className="h-8 w-36 text-[12.5px]"
                >
                  {!locked && <option value="allow">Autoriser</option>}
                  <option value="confirm">Confirmer</option>
                  <option value="deny">Interdire</option>
                </Select>
              </div>
            );
          })}
        </div>
      </Section>
      <MemorySection prefs={prefs} />
      <Section title="Utilisation (30 derniers jours)">
        {!usage?.last30Days.length ? (
          <p className="t-meta">Aucun appel au fournisseur IA.</p>
        ) : (
          <>
            <p className="t-sub mb-2">
              {totals?.calls} appels · {totals?.input.toLocaleString("fr-FR")} jetons en entrée · {totals?.output.toLocaleString("fr-FR")} en sortie
            </p>
            <div className="t-meta grid gap-1">
              {usage.last30Days.map((r) => (
                <div key={r.model + r.feature} className="flex justify-between">
                  <span>
                    {r.feature} · {r.model}
                  </span>
                  <span className="t-num">{r.calls} appels</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>
    </>
  );
}

type Memory = { id: string; category: string; content: string; sourceType: string | null; sourceId: string | null; updatedAt: string };

function MemorySection({ prefs }: { prefs: Prefs }) {
  const save = usePatch("/api/preferences");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: ["memory"], queryFn: () => api.get<{ items: Memory[] }>("/api/memory") });
  const [adding, setAdding] = useState<{ category: string; content: string } | null>(null);
  const [edit, setEdit] = useState<Memory | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["memory"] });
    } catch (e) {
      toast({ kind: "error", title: "Mémoire non modifiée", description: (e as Error).message });
    }
  };
  return (
    <Section title="Mémoire de l'IA" description="Ce que l'IA retient pour mieux t'aider. Rien n'est mémorisé sans ta validation, et jamais d'information sensible.">
      <label className="mb-3 flex items-center justify-between text-[13.5px]">
        Mémoire activée
        <Switch checked={prefs.memoryEnabled} onChange={(v) => save({ memoryEnabled: v })} />
      </label>
      <p className="t-label mb-2">Ce qui peut être mémorisé</p>
      <div className="mb-4 flex flex-wrap gap-3">
        {Object.entries(MEMORY_CATEGORIES).map(([k, l]) => (
          <label key={k} className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={prefs.memoryCategories.includes(k)} onChange={(v) => save({ memoryCategories: v ? [...prefs.memoryCategories, k] : prefs.memoryCategories.filter((x) => x !== k) }, { silent: true })} />
            {l}
          </label>
        ))}
      </div>
      <div className="mb-2 flex items-center justify-between">
        <p className="t-label">Souvenirs ({data?.items.length ?? 0})</p>
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding({ category: "preference", content: "" })}>
          Ajouter
        </Button>
      </div>
      {!data?.items.length ? (
        <EmptyState className="py-6" title="Mémoire vide" description="L'IA proposera des souvenirs que tu pourras valider." />
      ) : (
        data.items.map((m) => (
          <div key={m.id} className="group flex items-start gap-3 rounded-[8px] px-2 py-2 hover:bg-raised/50">
            <Badge>{MEMORY_CATEGORIES[m.category as keyof typeof MEMORY_CATEGORIES]}</Badge>
            <span className="flex-1 text-[13px]">{m.content}</span>
            <span className="t-meta shrink-0">
              {m.sourceType === "conversation" && m.sourceId ? (
                <Link href={`/assistant?c=${m.sourceId}`} className="text-accent">
                  source
                </Link>
              ) : (
                "manuel"
              )}
            </span>
            <button onClick={() => setEdit(m)} className="text-fg-3 opacity-0 group-hover:opacity-100 hover:text-fg" aria-label="Modifier">
              <Pencil className="size-3.5" />
            </button>
            <button onClick={() => run(() => api.del(`/api/memory/${m.id}`))} className="text-fg-3 opacity-0 group-hover:opacity-100 hover:text-danger" aria-label="Supprimer">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))
      )}
      <Dialog
        open={!!adding || !!edit}
        onClose={() => (setAdding(null), setEdit(null))}
        title={edit ? "Modifier le souvenir" : "Nouveau souvenir"}
        footer={
          <Button
            variant="primary"
            onClick={() =>
              run(async () => {
                if (edit) await api.patch(`/api/memory/${edit.id}`, { content: edit.content, category: edit.category });
                else if (adding) await api.post("/api/memory", adding);
                setAdding(null);
                setEdit(null);
              })
            }
          >
            Enregistrer
          </Button>
        }
      >
        {(() => {
          const v = edit ?? adding;
          if (!v) return null;
          const set = (p: Partial<typeof v>) => (edit ? setEdit({ ...edit, ...p }) : setAdding({ ...adding!, ...p }));
          return (
            <div className="flex flex-col gap-3">
              <Field label="Catégorie">
                <Select value={v.category} onChange={(e) => set({ category: e.target.value })}>
                  {Object.entries(MEMORY_CATEGORIES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Contenu">
                <Input value={v.content} onChange={(e) => set({ content: e.target.value })} placeholder="Ex. Je préfère les réunions l'après-midi" data-autofocus />
              </Field>
            </div>
          );
        })()}
      </Dialog>
    </Section>
  );
}

function Privacy({ prefs }: { prefs: Prefs }) {
  const [del, setDel] = useState(false);
  const [pw, setPw] = useState("");
  const [phrase, setPhrase] = useState("");
  const { toast } = useToast();
  void prefs;
  return (
    <>
      <Section title="Export des données" description="Télécharge toutes tes données BASILE OS au format JSON (les jetons et secrets sont exclus).">
        <a href="/api/export">
          <Button icon={<Download className="size-3.5" />}>Exporter mes données</Button>
        </a>
      </Section>
      <Section title="Services connectés et mémoire">
        <div className="flex flex-wrap gap-2">
          <Link href="/integrations">
            <Button size="sm">Gérer les services connectés</Button>
          </Link>
          <Link href="/settings?s=ai">
            <Button size="sm">Gérer la mémoire de l'IA</Button>
          </Link>
          <Link href="/settings?s=security">
            <Button size="sm">Sessions actives</Button>
          </Link>
        </div>
      </Section>
      <Section title="Suppression du compte" description="Supprime définitivement ton compte, toutes tes données et fichiers, et révoque l'accès Google. Irréversible.">
        <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(true)}>
          Supprimer mon compte
        </Button>
      </Section>
      <Dialog
        open={del}
        onClose={() => setDel(false)}
        title="Supprimer définitivement le compte ?"
        size="sm"
        footer={
          <Button
            variant="danger"
            disabled={phrase !== "SUPPRIMER" || !pw}
            onClick={async () => {
              try {
                await fetch("/api/account", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw, confirm: phrase }) }).then(async (r) => {
                  if (!r.ok) throw new Error((await r.json())?.error?.message ?? "Échec");
                });
                window.location.href = "/login";
              } catch (e) {
                toast({ kind: "error", title: "Suppression impossible", description: (e as Error).message });
              }
            }}
          >
            Supprimer définitivement
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Mot de passe">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="Tape SUPPRIMER pour confirmer">
            <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

type SecurityData = {
  sessions: { id: string; userAgent: string | null; ip: string | null; createdAt: string; lastSeenAt: string; current: boolean }[];
  events: { id: string; type: string; ip: string | null; createdAt: string; meta: Record<string, unknown> }[];
  tokens: { provider: string; accountEmail: string | null; scopes: string[]; expiresAt: string | null; updatedAt: string; hasRefresh: boolean }[];
};

const EVENT_LABELS: Record<string, string> = {
  "login.success": "Connexion réussie",
  "login.failure": "Échec de connexion",
  logout: "Déconnexion",
  "account.created": "Compte créé",
  "password.changed": "Mot de passe modifié",
  "session.revoked": "Session révoquée",
  "oauth.google.connected": "Google connecté",
  "oauth.google.disconnected": "Service Google déconnecté",
  "oauth.google.revoked": "Accès Google révoqué",
  "email.sent": "Email envoyé",
  "ai.action.approved": "Action IA validée",
  "ai.action.rejected": "Action IA refusée",
  "agent.permissions_changed": "Permissions d'agent modifiées",
  "data.exported": "Données exportées",
};

function Security() {
  const { data, refetch } = useQuery({ queryKey: ["security"], queryFn: () => api.get<SecurityData>("/api/security") });
  const { toast } = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  return (
    <>
      <Section title="Mot de passe" description="Changer le mot de passe ferme toutes les autres sessions.">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post("/api/auth/password", { current: cur, next });
              toast({ kind: "success", title: "Mot de passe modifié" });
              setCur("");
              setNext("");
              refetch();
            } catch (err) {
              toast({ kind: "error", title: "Échec", description: (err as Error).message });
            }
          }}
        >
          <Field label="Actuel">
            <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="Nouveau (10 caractères min.)">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} />
          </Field>
          <Button type="submit" variant="primary" disabled={!cur || next.length < 10}>
            Modifier
          </Button>
        </form>
      </Section>
      <Section title="Sessions actives">
        {data?.sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
            <Monitor className="size-4 text-fg-3" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px]">{s.userAgent?.slice(0, 80) ?? "Navigateur inconnu"}</p>
              <p className="t-meta">
                {s.ip ?? "IP locale"} · active {relativeTime(s.lastSeenAt)} · ouverte {relativeTime(s.createdAt)}
              </p>
            </div>
            {s.current ? (
              <Badge tone="success">Cette session</Badge>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await api.del(`/api/security/sessions/${s.id}`).catch((e) => toast({ kind: "error", title: "Échec", description: e.message }));
                  refetch();
                }}
              >
                Révoquer
              </Button>
            )}
          </div>
        ))}
      </Section>
      <Section title="Jetons OAuth" description="Stockés chiffrés (AES-256-GCM) côté serveur, jamais transmis au navigateur.">
        {!data?.tokens.length ? (
          <p className="t-meta">Aucun jeton stocké.</p>
        ) : (
          data.tokens.map((t) => (
            <div key={t.provider} className="t-meta grid gap-1">
              <p className="text-[13px] text-fg">Google · {t.accountEmail}</p>
              <p>Renouvellement automatique : {t.hasRefresh ? "oui" : "non"} · mis à jour {relativeTime(t.updatedAt)}</p>
              <p className="break-all">Autorisations : {t.scopes.join(", ")}</p>
            </div>
          ))
        )}
      </Section>
      <Section title="Historique des accès et actions sensibles">
        <div className="max-h-96 overflow-y-auto">
          {data?.events.map((e) => (
            <div key={e.id} className="flex items-center gap-3 border-b border-line-soft py-2 text-[13px] last:border-0">
              <span className={cn("size-1.5 rounded-full", e.type === "login.failure" ? "bg-danger" : "bg-fg-3")} />
              <span className="flex-1">{EVENT_LABELS[e.type] ?? e.type}</span>
              <span className="t-meta">{e.ip ?? ""}</span>
              <span className="t-meta w-28 text-right">{relativeTime(e.createdAt)}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
