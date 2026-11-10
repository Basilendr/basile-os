import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "./db";
import { randomToken, sha256 } from "./crypto";
import { env } from "./env";

export const SESSION_COOKIE = "bos_session";
const SESSION_DAYS = 30;

export type SessionUser = { id: string; email: string; displayName: string; sessionId: string };

export async function createSession(userId: string) {
  const db = await getDb();
  const token = randomToken(32);
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(schema.sessions).values({
    id: sha256(token),
    userId,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    ip: clientIp(h),
    expiresAt,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * Utilisateur courant, ou null. Vérifie l'expiration et prolonge l'activité.
 * Mis en cache pour la durée d'un rendu : les deux layouts et la page ne font qu'une requête.
 */
export const currentUser = cache(async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const sid = sha256(token);
  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.profiles.displayName,
      lastSeenAt: schema.sessions.lastSeenAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(and(eq(schema.sessions.id, sid), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  if (Date.now() - row.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, sid));
  }
  return { id: row.id, email: row.email, displayName: row.displayName ?? "Basile", sessionId: sid };
});

export function clientIp(h: Headers) {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

export async function logSecurityEvent(userId: string | null, type: string, meta: Record<string, unknown> = {}) {
  const db = await getDb();
  const h = await headers();
  await db.insert(schema.securityEvents).values({
    userId,
    type,
    ip: clientIp(h),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    meta,
  });
}
