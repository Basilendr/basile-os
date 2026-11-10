import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";

export type NotificationType =
  | "email"
  | "email_important"
  | "event_soon"
  | "reminder"
  | "deadline"
  | "project"
  | "agent"
  | "automation"
  | "integration_error"
  | "quiz"
  | "system";

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  entityType?: string;
  entityId?: string;
  importance?: "low" | "normal" | "high";
  /** Clé d'idempotence : une même clé ne produit qu'une notification. */
  dedupeKey?: string;
};

/** Crée une notification en respectant les préférences de l'utilisateur. Retourne null si ignorée. */
export async function notify(db: DB, userId: string, n: NotifyInput) {
  const [prefs] = await db
    .select({ p: schema.userPreferences.notificationPrefs })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId));
  if (prefs?.p?.[n.type] === false) return null;
  const rows = await db
    .insert(schema.notifications)
    .values({ userId, body: "", importance: "normal", ...n })
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

export async function listNotifications(db: DB, userId: string, opts: { unreadOnly?: boolean; type?: string; limit?: number }) {
  const where = [eq(schema.notifications.userId, userId)];
  if (opts.unreadOnly) where.push(isNull(schema.notifications.readAt));
  if (opts.type) where.push(eq(schema.notifications.type, opts.type));
  return db
    .select()
    .from(schema.notifications)
    .where(and(...where))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(opts.limit ?? 50);
}

export async function unreadCount(db: DB, userId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return r?.n ?? 0;
}
