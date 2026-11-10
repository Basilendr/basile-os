"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function AuthForm({ mode, next, google, initialError }: { mode: "setup" | "login"; next: string; google: boolean; initialError: string | null }) {
  const [email, setEmail] = useState(mode === "setup" ? "basileandre1002@gmail.com" : "");
  const [name, setName] = useState("Basile");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [issues, setIssues] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIssues({});
    if (mode === "setup" && password !== confirm) return setError("Les mots de passe ne correspondent pas.");
    setLoading(true);
    try {
      if (mode === "setup") {
        await api.post("/api/auth/setup", {
          email,
          password,
          displayName: name,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      } else {
        await api.post("/api/auth/login", { email, password });
      }
      window.location.href = next;
    } catch (err) {
      setLoading(false);
      if (err instanceof ApiError) {
        setError(err.message);
        setIssues(err.issues ?? {});
      } else setError("Impossible de joindre le serveur.");
    }
  }

  return (
    <form onSubmit={submit} className="surface flex flex-col gap-3.5 p-6 shadow-[var(--shadow-lg)]">
      {google ? (
        <a
          href={`/api/auth/google?next=${encodeURIComponent(next)}`}
          className="focus-ring flex h-10 items-center justify-center gap-2.5 rounded-[11px] border border-line bg-card text-[14px] font-medium shadow-[var(--shadow-sm)] transition-colors hover:bg-raised/60 active:scale-[0.99]"
        >
          <GoogleG />
          Continuer avec Google
        </a>
      ) : (
        <div className="flex h-10 cursor-not-allowed items-center justify-center gap-2.5 rounded-[11px] border border-dashed border-line text-[13.5px] text-fg-3" title={mode === "setup" ? "Crée d'abord ton compte, puis ajoute l'ID client OAuth Google dans Paramètres → Configuration." : "Ajoute l'ID client OAuth Google dans Paramètres → Configuration pour activer ce bouton."}>
          <GoogleG />
          Continuer avec Google · à configurer
        </div>
      )}
      <div className="flex items-center gap-3 text-[12px] text-fg-3">
        <span className="h-px flex-1 bg-line" />
        ou avec un mot de passe
        <span className="h-px flex-1 bg-line" />
      </div>
      {mode === "setup" && (
        <Field label="Nom affiché" error={issues.displayName?.[0]}>
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </Field>
      )}
      <Field label="Adresse email" error={issues.email?.[0]}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus={mode === "login"} />
      </Field>
      <Field label="Mot de passe" hint={mode === "setup" ? "10 caractères minimum." : undefined} error={issues.password?.[0]}>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={mode === "setup" ? 10 : 1}
          autoComplete={mode === "setup" ? "new-password" : "current-password"}
        />
      </Field>
      {mode === "setup" && (
        <Field label="Confirmer le mot de passe">
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
      )}
      {error && <p className="rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
      <Button type="submit" variant="primary" loading={loading} className="mt-1 h-10 w-full justify-center">
        {mode === "setup" ? "Créer mon espace" : "Se connecter"}
      </Button>
    </form>
  );
}
