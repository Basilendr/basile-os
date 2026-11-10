import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { env, googleConfigured } from "@/lib/env";
import { secret } from "@/lib/secrets";
import { decrypt, encrypt, randomToken } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { notify } from "../notifications";

export type GoogleService = "gmail" | "calendar" | "drive" | "contacts";

/** Permissions minimales par service. */
export const SCOPES: Record<GoogleService, string[]> = {
  gmail: ["https://www.googleapis.com/auth/gmail.modify"],
  calendar: ["https://www.googleapis.com/auth/calendar.events"],
  drive: ["https://www.googleapis.com/auth/drive.readonly"],
  contacts: ["https://www.googleapis.com/auth/contacts.readonly"],
};
const BASE_SCOPES = ["openid", "email"];
/** Permissions demandées en plus, sans être exigées : agenda « École » séparé, créé et géré par Basile OS. */
export const EXTRA_SCOPES: Partial<Record<GoogleService, string[]>> = { calendar: ["https://www.googleapis.com/auth/calendar.app.created"] };

/** Permissions réellement accordées par Google (jeton enregistré). */
export async function grantedScopes(db: DB, userId: string) {
  const [t] = await db.select({ scopes: schema.oauthTokens.scopes }).from(schema.oauthTokens).where(and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, "google")));
  return t?.scopes ?? [];
}

export const redirectUri = () => `${env.APP_URL}/api/integrations/google/callback`;

function requireConfig() {
  if (!googleConfigured()) {
    throw new AppError("not_configured", "OAuth Google n'est pas configuré : renseigne GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET (voir README).");
  }
}

/** Services demandés lors d'une « Connexion avec Google » : documents, emails et agenda en une seule autorisation. */
export const LOGIN_SERVICES: GoogleService[] = ["drive", "gmail", "calendar"];

/** URL d'autorisation (PKCE S256 + state anti-CSRF stocké côté serveur). `userId` null = connexion avec Google. */
export async function buildAuthUrl(db: DB, userId: string | null, services: GoogleService[], returnTo = "/integrations", purpose: "connect" | "login" = "connect") {
  requireConfig();
  await db.delete(schema.oauthStates).where(lt(schema.oauthStates.createdAt, new Date(Date.now() - 15 * 60_000)));
  const state = randomToken(24);
  const codeVerifier = randomToken(48);
  const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
  await db.insert(schema.oauthStates).values({ state, userId, purpose, codeVerifier, services, returnTo });
  const params = new URLSearchParams({
    client_id: secret("GOOGLE_CLIENT_ID")!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: [...BASE_SCOPES, ...services.flatMap((s) => [...SCOPES[s], ...(EXTRA_SCOPES[s] ?? [])])].join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: purpose === "login" ? "select_account consent" : "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope: string; id_token?: string; token_type: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: secret("GOOGLE_CLIENT_ID")!, client_secret: secret("GOOGLE_CLIENT_SECRET")!, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new AppError("integration_error", `Google OAuth : ${data.error_description ?? data.error ?? res.status}`, { oauthError: data.error });
    throw err;
  }
  return data as TokenResponse;
}

type GoogleProfile = { sub: string; email: string | null; emailVerified: boolean; name: string | null; picture: string | null };

async function fetchProfile(accessToken: string): Promise<GoogleProfile | null> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const d = (await res.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
  return d.sub ? { sub: d.sub, email: d.email?.toLowerCase() ?? null, emailVerified: Boolean(d.email_verified), name: d.name ?? null, picture: d.picture ?? null } : null;
}

async function consumeState(db: DB, params: { code?: string | null; state?: string | null; error?: string | null }) {
  requireConfig();
  if (!params.state) throw new AppError("bad_request", "Paramètre state manquant");
  const [st] = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.state, params.state));
  if (st) await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, params.state));
  if (!st || Date.now() - st.createdAt.getTime() > 15 * 60_000) throw new AppError("forbidden", "Requête OAuth invalide ou expirée");
  if (params.error) throw new AppError("forbidden", params.error === "access_denied" ? "Autorisation refusée sur Google." : `Google : ${params.error}`);
  if (!params.code) throw new AppError("bad_request", "Code d'autorisation manquant");
  return st;
}

/** Enregistre les jetons (chiffrés) et marque connectés les seuls services dont les permissions ont réellement été accordées. */
async function storeGrant(db: DB, userId: string, tok: TokenResponse, email: string | null, services: GoogleService[]) {
  const granted = tok.scope.split(" ");
  const [existing] = await db.select().from(schema.oauthTokens).where(and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, "google")));
  const values = {
    userId,
    provider: "google",
    accountEmail: email,
    accessTokenEnc: encrypt(tok.access_token),
    refreshTokenEnc: tok.refresh_token ? encrypt(tok.refresh_token) : (existing?.refreshTokenEnc ?? null),
    expiresAt: new Date(Date.now() + tok.expires_in * 1000),
    scopes: granted,
  };
  if (existing) await db.update(schema.oauthTokens).set(values).where(eq(schema.oauthTokens.id, existing.id));
  else await db.insert(schema.oauthTokens).values(values);
  const connected: GoogleService[] = [];
  for (const service of services) {
    const ok = SCOPES[service].every((s) => granted.includes(s));
    await upsertIntegration(db, userId, service, ok ? { status: "connected", lastError: null, accountEmail: email, scopes: SCOPES[service] } : { status: "error", lastError: "Permission non accordée sur l'écran Google", accountEmail: email });
    if (ok) connected.push(service);
  }
  return connected;
}

/** Connexion d'un service depuis une session existante. */
export async function handleCallback(db: DB, userId: string, params: { code?: string | null; state?: string | null; error?: string | null }) {
  const st = await consumeState(db, params);
  if (st.userId !== userId || st.purpose !== "connect") throw new AppError("forbidden", "Requête OAuth invalide ou expirée");
  const tok = await tokenRequest({ code: params.code!, grant_type: "authorization_code", redirect_uri: redirectUri(), code_verifier: st.codeVerifier });
  const profile = await fetchProfile(tok.access_token);
  const connected = await storeGrant(db, userId, tok, profile?.email ?? null, st.services as GoogleService[]);
  if (profile) await db.update(schema.users).set({ googleSub: profile.sub }).where(and(eq(schema.users.id, userId), isNull(schema.users.googleSub)));
  return { connected, returnTo: st.returnTo ?? "/integrations", email: profile?.email ?? null };
}

/**
 * Connexion avec Google : retrouve le compte propriétaire par identifiant Google ou email vérifié,
 * ou crée le compte au premier lancement. Un autre compte Google est refusé.
 */
export async function handleLoginCallback(db: DB, params: { code?: string | null; state?: string | null; error?: string | null }) {
  const st = await consumeState(db, params);
  if (st.purpose !== "login") throw new AppError("forbidden", "Requête OAuth invalide ou expirée");
  const tok = await tokenRequest({ code: params.code!, grant_type: "authorization_code", redirect_uri: redirectUri(), code_verifier: st.codeVerifier });
  const profile = await fetchProfile(tok.access_token);
  if (!profile?.email || !profile.emailVerified) throw new AppError("forbidden", "Compte Google sans adresse email vérifiée.");
  let [user] = await db.select().from(schema.users).where(eq(schema.users.googleSub, profile.sub));
  if (!user) [user] = await db.select().from(schema.users).where(eq(schema.users.email, profile.email));
  let created = false;
  if (!user) {
    const { hasAnyUser, createOwnerFromGoogle } = await import("../account");
    if (await hasAnyUser(db)) throw new AppError("forbidden", `Le compte Google ${profile.email} n'est pas autorisé sur cette instance.`);
    user = await createOwnerFromGoogle(db, { email: profile.email, sub: profile.sub, name: profile.name ?? profile.email.split("@")[0], picture: profile.picture });
    created = true;
  } else if (!user.googleSub) {
    await db.update(schema.users).set({ googleSub: profile.sub }).where(eq(schema.users.id, user.id));
  } else if (user.googleSub !== profile.sub) {
    throw new AppError("forbidden", "Ce compte Google ne correspond pas au compte lié.");
  }
  const connected = await storeGrant(db, user.id, tok, profile.email, st.services as GoogleService[]);
  if (profile.picture) await db.update(schema.profiles).set({ avatarUrl: profile.picture }).where(and(eq(schema.profiles.userId, user.id), isNull(schema.profiles.avatarUrl)));
  return { userId: user.id, connected, created, email: profile.email, returnTo: st.returnTo ?? "/" };
}

export async function upsertIntegration(db: DB, userId: string, service: string, values: Partial<typeof schema.integrations.$inferInsert>) {
  await db
    .insert(schema.integrations)
    .values({ userId, service, provider: service === "ai" ? "ai" : "google", status: "disconnected", ...values })
    .onConflictDoUpdate({ target: [schema.integrations.userId, schema.integrations.service], set: values });
}

/** Jeton d'accès valide (renouvelé automatiquement), jamais exposé au navigateur. */
export async function getAccessToken(db: DB, userId: string, force = false): Promise<string> {
  requireConfig();
  const [row] = await db.select().from(schema.oauthTokens).where(and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, "google")));
  if (!row) throw new AppError("not_configured", "Compte Google non connecté");
  if (!force && row.expiresAt && row.expiresAt.getTime() - Date.now() > 60_000) return decrypt(row.accessTokenEnc);
  if (!row.refreshTokenEnc) throw new AppError("integration_error", "Jeton de renouvellement absent : reconnecte Google.");
  try {
    const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(row.refreshTokenEnc) });
    await db
      .update(schema.oauthTokens)
      .set({ accessTokenEnc: encrypt(tok.access_token), expiresAt: new Date(Date.now() + tok.expires_in * 1000), scopes: tok.scope ? tok.scope.split(" ") : row.scopes })
      .where(eq(schema.oauthTokens.id, row.id));
    return tok.access_token;
  } catch (e) {
    if (e instanceof AppError && (e.details as { oauthError?: string })?.oauthError === "invalid_grant") {
      log.warn("google.invalid_grant", { userId });
      await db.update(schema.integrations).set({ status: "error", lastError: "Accès Google expiré ou révoqué : reconnecte ton compte." }).where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "google")));
      await notify(db, userId, { type: "integration_error", title: "Connexion Google interrompue", body: "L'accès a expiré ou a été révoqué. Reconnecte ton compte.", href: "/integrations", importance: "high", dedupeKey: `google-invalid-grant:${new Date().toISOString().slice(0, 10)}` });
    }
    throw e;
  }
}

/** Arrête l'usage d'un service ; révoque entièrement le jeton si plus aucun service n'est actif. */
export async function disconnectService(db: DB, userId: string, service: GoogleService | "all") {
  const services: GoogleService[] = service === "all" ? ["gmail", "calendar", "drive", "contacts"] : [service];
  for (const s of services) await upsertIntegration(db, userId, s, { status: "disconnected", lastError: null, syncState: {} });
  const active = await db.select().from(schema.integrations).where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "google"), eq(schema.integrations.status, "connected")));
  if (active.length === 0) {
    const [row] = await db.select().from(schema.oauthTokens).where(and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, "google")));
    if (row) {
      const token = row.refreshTokenEnc ? decrypt(row.refreshTokenEnc) : decrypt(row.accessTokenEnc);
      const res = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }).catch(() => null);
      if (res && !res.ok && res.status !== 400) log.warn("google.revoke_failed", { status: res.status });
      await db.delete(schema.oauthTokens).where(eq(schema.oauthTokens.id, row.id));
    }
    return { revoked: true };
  }
  return { revoked: false };
}

export async function isServiceConnected(db: DB, userId: string, service: GoogleService) {
  if (!googleConfigured()) return false;
  const [i] = await db.select({ status: schema.integrations.status }).from(schema.integrations).where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.service, service)));
  return i?.status === "connected";
}
