"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, LocateFixed, MapPin, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type SecretName = "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GEMINI_API_KEY" | "GROQ_API_KEY" | "MISTRAL_API_KEY" | "VOYAGE_API_KEY" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET";
type Route = { task: string; label: string; description: string; active: string | null; chain: { provider: string; label: string; configured: boolean }[] };
type Config = { secrets: Record<SecretName, { set: boolean; source: "env" | "app" | null; hint: string | null }>; routes: Route[]; redirectUri: string; appUrl: string };

const GROUPS: { title: string; description: React.ReactNode; keys: { name: SecretName; label: string; placeholder: string; help: React.ReactNode }[] }[] = [
  {
    title: "Intelligence artificielle",
    description: "Une seule clé suffit, mais avec plusieurs IA gratuites le site choisit tout seul la meilleure pour chaque fonction et passe à la suivante si l'une est saturée. Chaque clé est vérifiée avant d'être enregistrée. Ne mets jamais de carte bancaire sur ces sites : sans carte, rien ne peut être facturé.",
    keys: [
      { name: "ANTHROPIC_API_KEY", label: "Clé API Anthropic (Claude)", placeholder: "sk-ant-…", help: <>Créer une clé sur <a className="text-accent hover:underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a> → API Keys.</> },
      { name: "GEMINI_API_KEY", label: "Clé API Google Gemini (gratuite)", placeholder: "AIza…", help: <>Gratuite avec quota : <a className="text-accent hover:underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a> → Create API key. Activée automatiquement si aucune autre IA n'est configurée.</> },
      { name: "GROQ_API_KEY", label: "Clé API Groq (gratuite)", placeholder: "gsk_…", help: <>Gratuite, sans carte : <a className="text-accent hover:underline" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a> → Create API Key. La plus rapide : sert en premier pour les textes courts (briefing, résumés, correction des réponses de quiz) et prend le relais de Gemini pour l'assistant.</> },
      { name: "MISTRAL_API_KEY", label: "Clé API Mistral (gratuite)", placeholder: "…", help: <>Offre gratuite « Experiment » (vérification par SMS, sans carte) : <a className="text-accent hover:underline" href="https://console.mistral.ai/api-keys" target="_blank" rel="noreferrer">console.mistral.ai/api-keys</a> → Create new key. Française, lit les PDF et les photos : prend le relais de Gemini pour les emplois du temps reçus, les cours scannés et les quiz.</> },
      { name: "OPENAI_API_KEY", label: "Clé API OpenAI / ChatGPT (payante)", placeholder: "sk-…", help: <>Créée sur <a className="text-accent hover:underline" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com</a> ; facturée à l'usage (crédit prépayé). Sert aussi aux embeddings.</> },
      { name: "VOYAGE_API_KEY", label: "Clé API Voyage (optionnelle)", placeholder: "pa-…", help: <>Embeddings recommandés pour le Second Brain (recherche par le sens).</> },
    ],
  },
  {
    title: "Connexion Google",
    description: "Nécessaire pour « Continuer avec Google », Gmail, Agenda et Drive. Crée un identifiant OAuth « Application Web » dans Google Cloud.",
    keys: [
      { name: "GOOGLE_CLIENT_ID", label: "ID client OAuth", placeholder: "xxxxxxxx.apps.googleusercontent.com", help: <>Google Cloud → API et services → Identifiants → Créer un ID client OAuth.</> },
      { name: "GOOGLE_CLIENT_SECRET", label: "Code secret du client", placeholder: "GOCSPX-…", help: <>Affiché à la création de l'ID client.</> },
    ],
  },
];

/** Configuration de l'instance : clés saisies ici, validées puis chiffrées en base (jamais renvoyées au navigateur). */
export function ConfigSection() {
  const { data } = useQuery({ queryKey: ["config"], queryFn: () => api.get<Config>("/api/config") });
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  if (!data) return <Card className="h-64 p-5" />;
  return (
    <>
      {GROUPS.map((g) => (
        <Card key={g.title} className="mb-4 p-5">
          <h2 className="t-section">{g.title}</h2>
          <p className="t-sub mt-1 mb-4">{g.description}</p>
          {g.title === "Connexion Google" && (
            <div className="mb-4 rounded-[12px] border border-line bg-bg p-3">
              <p className="text-[12.5px] font-medium">URI de redirection autorisée à déclarer</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-[8px] border border-line bg-card px-2.5 py-1.5 text-[12px]">{data.redirectUri}</code>
                <Button
                  size="sm"
                  icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  onClick={() =>
                    navigator.clipboard.writeText(data.redirectUri).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                      toast({ kind: "success", title: "URI copiée" });
                    })
                  }
                >
                  Copier
                </Button>
              </div>
              <p className="t-meta mt-2">Active aussi les API Gmail, Google Calendar et Google Drive dans la bibliothèque d'API du projet.</p>
            </div>
          )}
          {g.title === "Intelligence artificielle" && <RoutesTable routes={data.routes} />}
          <div className="flex flex-col divide-y divide-line-soft">
            {g.keys.map((k) => (
              <SecretRow key={k.name} name={k.name} label={k.label} placeholder={k.placeholder} help={k.help} state={data.secrets[k.name]} />
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}

/** Quelle IA répond pour chaque fonction, et dans quel ordre elles prennent le relais. */
function RoutesTable({ routes }: { routes: Route[] }) {
  return (
    <div className="mb-4 rounded-[12px] border border-line bg-bg p-3">
      <p className="text-[12.5px] font-medium">Choix automatique de l'IA selon la fonction</p>
      <ul className="mt-2 flex flex-col gap-2.5">
        {routes.map((r) => (
          <li key={r.task} className="text-[12.5px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{r.label}</span>
              {r.active ? <Badge tone="success">{r.chain.find((c) => c.provider === r.active)?.label}</Badge> : <Badge tone="danger">Aucune clé</Badge>}
            </div>
            <p className="t-meta mt-0.5">{r.description}</p>
            <p className="t-meta mt-0.5">
              Ordre :{" "}
              {r.chain.map((c, i) => (
                <span key={c.provider} className={cn(!c.configured && "line-through opacity-60")}>
                  {i ? " → " : ""}
                  {c.label}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
      <p className="t-meta mt-2">Barré = pas de clé. Si une IA est à court de quota, saturée ou trop lente, la suivante répond à sa place.</p>
    </div>
  );
}

function SecretRow({ name, label, placeholder, help, state }: { name: SecretName; label: string; placeholder: string; help: React.ReactNode; state: Config["secrets"][SecretName] }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!state.set);
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = (secrets: Config["secrets"]) => {
    qc.setQueryData<Config>(["config"], (c) => (c ? { ...c, secrets } : c));
    qc.invalidateQueries({ queryKey: ["config"] });
    ["status", "integrations", "me"].forEach((q) => qc.invalidateQueries({ queryKey: [q] }));
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put<{ secrets: Config["secrets"] }>("/api/config", { name, value: value.trim() });
      refresh(r.secrets);
      setValue("");
      setEditing(false);
      toast({ kind: "success", title: "Clé vérifiée et enregistrée", description: label });
    } catch (e) {
      toast({ kind: "error", title: "Clé refusée", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      const r = await api.del<{ secrets: Config["secrets"] }>(`/api/config?name=${name}`);
      refresh(r.secrets);
      setEditing(true);
      toast({ kind: "success", title: "Clé supprimée" });
    } catch (e) {
      toast({ kind: "error", title: "Suppression impossible", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 text-fg-3" />
        <span className="text-[13.5px] font-medium">{label}</span>
        {state.set ? (
          <Badge tone="success">
            {state.hint} · {state.source === "env" ? "variable d'environnement" : "enregistrée"}
          </Badge>
        ) : (
          <Badge>Non configurée</Badge>
        )}
        {state.set && !editing && state.source === "app" && (
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Remplacer
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={remove} disabled={busy}>
              Retirer
            </Button>
          </span>
        )}
      </div>
      <p className="t-meta mt-1 pl-6">{help}</p>
      {state.source === "env" ? (
        <p className="t-meta mt-1 pl-6">Définie dans l'environnement du serveur : elle a priorité et se modifie là-bas.</p>
      ) : (
        editing && (
          <form
            className="mt-2.5 flex gap-2 pl-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim().length >= 8) save();
            }}
          >
            <Input type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="flex-1 font-mono text-[12.5px]" aria-label={label} />
            <Button type="submit" variant="primary" disabled={busy || value.trim().length < 8} loading={busy}>
              Vérifier et enregistrer
            </Button>
          </form>
        )
      )}
    </div>
  );
}

type Place = { name: string; label: string; lat: number; lon: number };

/** Ville de la météo : recherche (géocodage Open-Meteo) ou position du navigateur. */
export function WeatherSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: weather } = useQuery({ queryKey: ["weather"], queryFn: () => api.get<{ place: string; isDefaultPlace: boolean }>("/api/weather") });
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (p: { city: string; lat: number; lon: number }) => {
    try {
      await api.put("/api/weather", p);
      setResults(null);
      setQ("");
      qc.invalidateQueries({ queryKey: ["weather"] });
      toast({ kind: "success", title: "Ville enregistrée", description: p.city });
    } catch (e) {
      toast({ kind: "error", title: "Non enregistrée", description: (e as Error).message });
    }
  };
  return (
    <Card className="mb-4 p-5" id="weather">
      <h2 className="t-section">Météo</h2>
      <p className="t-sub mt-1 mb-4">
        Ville actuelle : <b className="font-medium text-fg">{weather?.place ?? "…"}</b>
        {weather?.isDefaultPlace && " (par défaut, d'après ton fuseau horaire)"}. Données Open-Meteo.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (q.trim().length < 2) return;
          setBusy(true);
          try {
            setResults((await api.get<{ items: Place[] }>(`/api/weather/geocode?q=${encodeURIComponent(q.trim())}`)).items);
          } catch (err) {
            toast({ kind: "error", title: "Recherche impossible", description: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une ville…" className="min-w-[200px] flex-1" aria-label="Ville" />
        <Button type="submit" disabled={q.trim().length < 2} loading={busy}>
          Rechercher
        </Button>
        <Button
          type="button"
          icon={<LocateFixed className="size-3.5" />}
          onClick={() => {
            if (!navigator.geolocation) return toast({ kind: "error", title: "Géolocalisation indisponible" });
            navigator.geolocation.getCurrentPosition(
              (pos) => pick({ city: "Ma position", lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 }),
              () => toast({ kind: "error", title: "Position refusée", description: "Autorise la localisation dans le navigateur ou cherche ta ville." }),
              { timeout: 10_000 },
            );
          }}
        >
          Ma position
        </Button>
      </form>
      {results && (
        <ul className="mt-3 overflow-hidden rounded-[12px] border border-line">
          {results.length === 0 ? (
            <li className="t-meta px-3 py-3">Aucune ville trouvée.</li>
          ) : (
            results.map((r) => (
              <li key={`${r.lat},${r.lon}`}>
                <button onClick={() => pick({ city: r.name, lat: r.lat, lon: r.lon })} className={cn("flex w-full items-center gap-2.5 border-b border-line-soft px-3 py-2.5 text-left text-[13px] last:border-0 hover:bg-raised/60")}>
                  <MapPin className="size-3.5 text-fg-3" />
                  <span className="font-medium">{r.name}</span>
                  <span className="t-meta truncate">{r.label.slice(r.name.length + 2)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </Card>
  );
}
