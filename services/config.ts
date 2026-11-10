import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { SECRET_NAMES, secret, secretSource, setCachedSecret, type SecretName } from "@/lib/secrets";

export function configStatus() {
  return Object.fromEntries(
    SECRET_NAMES.map((n) => {
      const v = secret(n);
      return [n, { set: Boolean(v), source: secretSource(n), hint: v ? `…${v.slice(-4)}` : null }];
    }),
  ) as Record<SecretName, { set: boolean; source: "env" | "app" | null; hint: string | null }>;
}

/** Vérifie réellement la clé auprès du fournisseur avant de l'enregistrer. */
async function validate(name: SecretName, value: string) {
  if (name === "ANTHROPIC_API_KEY") {
    try {
      await new Anthropic({ apiKey: value, maxRetries: 0 }).models.list({ limit: 1 });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new AppError("bad_request", "Clé Anthropic refusée par l'API.");
      if (e instanceof Anthropic.APIError) throw new AppError("bad_request", `Vérification impossible (${e.status}) : ${e.message}`);
      throw new AppError("integration_error", "Impossible de joindre l'API Anthropic.");
    }
  } else if (name === "OPENAI_API_KEY") {
    const r = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${value}` } }).catch(() => null);
    if (!r) throw new AppError("integration_error", "Impossible de joindre l'API OpenAI.");
    if (!r.ok) throw new AppError("bad_request", `Clé OpenAI refusée (${r.status}).`);
  } else if (name === "GEMINI_API_KEY") {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": value } }).catch(() => null);
    if (!r) throw new AppError("integration_error", "Impossible de joindre l'API Gemini.");
    if (!r.ok) throw new AppError("bad_request", `Clé Gemini refusée (${r.status}).`);
  } else if (name === "GROQ_API_KEY" || name === "MISTRAL_API_KEY") {
    const label = name === "GROQ_API_KEY" ? "Groq" : "Mistral";
    const r = await fetch(name === "GROQ_API_KEY" ? "https://api.groq.com/openai/v1/models" : "https://api.mistral.ai/v1/models", { headers: { authorization: `Bearer ${value}` } }).catch(() => null);
    if (!r) throw new AppError("integration_error", `Impossible de joindre l'API ${label}.`);
    if (!r.ok) throw new AppError("bad_request", `Clé ${label} refusée (${r.status}).`);
  } else if (name === "VOYAGE_API_KEY") {
    const r = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { authorization: `Bearer ${value}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "voyage-3.5", input: ["test"] }),
    }).catch(() => null);
    if (!r) throw new AppError("integration_error", "Impossible de joindre l'API Voyage.");
    if (!r.ok) throw new AppError("bad_request", `Clé Voyage refusée (${r.status}).`);
  } else if (name === "GOOGLE_CLIENT_ID") {
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(value)) throw new AppError("bad_request", "L'ID client Google doit se terminer par .apps.googleusercontent.com");
  } else if (name === "GOOGLE_CLIENT_SECRET") {
    if (value.length < 10) throw new AppError("bad_request", "Secret client Google invalide.");
  }
}

export async function setSecret(db: DB, userId: string, name: SecretName, value: string) {
  const v = value.trim();
  if (secretSource(name) === "env") throw new AppError("conflict", "Cette valeur est définie par une variable d'environnement du serveur.");
  await validate(name, v);
  await db
    .insert(schema.instanceSecrets)
    .values({ name, valueEnc: encrypt(v), updatedBy: userId })
    .onConflictDoUpdate({ target: schema.instanceSecrets.name, set: { valueEnc: encrypt(v), updatedBy: userId } });
  setCachedSecret(name, v);
}

export async function deleteSecret(db: DB, name: SecretName) {
  await db.delete(schema.instanceSecrets).where(eq(schema.instanceSecrets.name, name));
  setCachedSecret(name, null);
}
