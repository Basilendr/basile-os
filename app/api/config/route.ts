import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { DEFAULT_MODELS, providerConfigured, type ProviderName } from "@/services/ai/provider";
import { z } from "zod";
import { route } from "@/lib/api";
import { env } from "@/lib/env";
import { logSecurityEvent } from "@/lib/auth";
import { SECRET_NAMES } from "@/lib/secrets";
import { configStatus, deleteSecret, setSecret } from "@/services/config";

const Name = z.enum(SECRET_NAMES);

export const GET = route({}, async () => ({ secrets: configStatus(), redirectUri: `${env.APP_URL}/api/integrations/google/callback`, appUrl: env.APP_URL }));

export const PUT = route({ body: z.object({ name: Name, value: z.string().min(8).max(500) }), rate: [10, 60_000] }, async ({ db, user, body }) => {
  await setSecret(db, user.id, body.name, body.value);
  await logSecurityEvent(user.id, "config.secret_set", { name: body.name });
  // Une clé d'IA ajoutée alors que le fournisseur choisi n'a pas de clé devient le fournisseur actif.
  const provider = ({ ANTHROPIC_API_KEY: "anthropic", OPENAI_API_KEY: "openai", GEMINI_API_KEY: "gemini" } as const)[body.name as "ANTHROPIC_API_KEY"];
  if (provider) {
    const [p] = await db.select({ aiProvider: schema.userPreferences.aiProvider }).from(schema.userPreferences).where(eq(schema.userPreferences.userId, user.id));
    const current = (p?.aiProvider ?? "anthropic") as ProviderName;
    if (current !== provider && !providerConfigured(current)) await db.update(schema.userPreferences).set({ aiProvider: provider, aiModel: DEFAULT_MODELS[provider] }).where(eq(schema.userPreferences.userId, user.id));
  }
  return { secrets: configStatus() };
});

export const DELETE = route({ query: z.object({ name: Name }) }, async ({ db, user, query }) => {
  await deleteSecret(db, query.name);
  await logSecurityEvent(user.id, "config.secret_removed", { name: query.name });
  return { secrets: configStatus() };
});
