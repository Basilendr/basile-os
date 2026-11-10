import { desc, eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";

export const GET = route({}, async ({ db, user }) => {
  const sessions = await db.select({ id: schema.sessions.id, userAgent: schema.sessions.userAgent, ip: schema.sessions.ip, createdAt: schema.sessions.createdAt, lastSeenAt: schema.sessions.lastSeenAt, expiresAt: schema.sessions.expiresAt }).from(schema.sessions).where(eq(schema.sessions.userId, user.id)).orderBy(desc(schema.sessions.lastSeenAt));
  const events = await db.select().from(schema.securityEvents).where(eq(schema.securityEvents.userId, user.id)).orderBy(desc(schema.securityEvents.createdAt)).limit(100);
  const [tok] = await db.select({ provider: schema.oauthTokens.provider, accountEmail: schema.oauthTokens.accountEmail, scopes: schema.oauthTokens.scopes, expiresAt: schema.oauthTokens.expiresAt, updatedAt: schema.oauthTokens.updatedAt, hasRefresh: schema.oauthTokens.refreshTokenEnc }).from(schema.oauthTokens).where(eq(schema.oauthTokens.userId, user.id));
  return {
    // l'identifiant de session est un hachage ; on n'en expose qu'un préfixe
    sessions: sessions.map((s) => ({ ...s, id: s.id.slice(0, 16), current: s.id === user.sessionId })),
    events,
    tokens: tok ? [{ ...tok, hasRefresh: Boolean(tok.hasRefresh) }] : [],
  };
});
