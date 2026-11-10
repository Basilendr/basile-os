import "server-only";
import { env } from "./env";

/**
 * Secrets de l'instance : variables d'environnement prioritaires, sinon valeurs saisies
 * dans Paramètres → Configuration (chiffrées en base, déchiffrées en mémoire au démarrage).
 */
export const SECRET_NAMES = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "VOYAGE_API_KEY"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

const g = globalThis as unknown as { __basileSecrets?: Map<SecretName, string> };
const cache: Map<SecretName, string> = (g.__basileSecrets ??= new Map());

export function secret(name: SecretName): string | undefined {
  return (env[name] as string | undefined) || cache.get(name) || undefined;
}

export function secretSource(name: SecretName): "env" | "app" | null {
  if (env[name]) return "env";
  return cache.has(name) ? "app" : null;
}

export function setCachedSecret(name: SecretName, value: string | null) {
  if (value) cache.set(name, value);
  else cache.delete(name);
}

export const googleConfigured = () => Boolean(secret("GOOGLE_CLIENT_ID") && secret("GOOGLE_CLIENT_SECRET"));
