import { eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { env, googleConfigured } from "@/lib/env";
import { secret } from "@/lib/secrets";
import { SCOPES } from "@/services/google/oauth";
import { embeddingsProvider } from "@/services/ai/embeddings";

export const GET = route({}, async ({ db, user }) => {
  const rows = await db.select().from(schema.integrations).where(eq(schema.integrations.userId, user.id));
  const [tok] = await db.select({ email: schema.oauthTokens.accountEmail, scopes: schema.oauthTokens.scopes, updatedAt: schema.oauthTokens.updatedAt }).from(schema.oauthTokens).where(eq(schema.oauthTokens.userId, user.id));
  const by = Object.fromEntries(rows.map((r) => [r.service, r]));
  const g = (service: keyof typeof SCOPES) => ({
    service,
    status: by[service]?.status ?? "disconnected",
    accountEmail: by[service]?.accountEmail ?? null,
    lastSyncAt: by[service]?.lastSyncAt ?? null,
    lastError: by[service]?.lastError ?? null,
    scopes: SCOPES[service],
  });
  return {
    google: { configured: googleConfigured(), redirectUri: `${env.APP_URL}/api/integrations/google/callback`, account: tok?.email ?? null, grantedScopes: tok?.scopes ?? [], services: [g("gmail"), g("calendar"), g("drive"), g("contacts")] },
    ai: {
      anthropic: Boolean(secret("ANTHROPIC_API_KEY")),
      openai: Boolean(secret("OPENAI_API_KEY")),
      gemini: Boolean(secret("GEMINI_API_KEY")),
      embeddings: embeddingsProvider(),
    },
  };
});
