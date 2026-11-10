import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { route, zId } from "@/lib/api";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";

const own = (u: string, id: string) => and(eq(schema.aiConversations.id, id), eq(schema.aiConversations.userId, u));

export const GET = route({}, async ({ db, user, params }) => {
  const id = zId.parse(params.id);
  const [c] = await db.select().from(schema.aiConversations).where(own(user.id, id));
  if (!c) throw notFound("Conversation");
  const messages = await db.select().from(schema.aiMessages).where(eq(schema.aiMessages.conversationId, id)).orderBy(asc(schema.aiMessages.createdAt));
  const pendingIds = messages.flatMap((m) => ((m.context as { pending?: string[] }).pending ?? []));
  const pending = pendingIds.length ? await db.select().from(schema.aiPendingActions).where(and(eq(schema.aiPendingActions.userId, user.id), inArray(schema.aiPendingActions.id, pendingIds))) : [];
  return { ...c, messages, pending };
});

export const PATCH = route({ body: z.object({ title: z.string().trim().min(1).max(200) }) }, async ({ db, user, params, body }) => {
  const [c] = await db.update(schema.aiConversations).set({ title: body.title }).where(own(user.id, zId.parse(params.id))).returning();
  if (!c) throw notFound("Conversation");
  return c;
});

export const DELETE = route({}, async ({ db, user, params }) => {
  const r = await db.delete(schema.aiConversations).where(own(user.id, zId.parse(params.id))).returning();
  if (!r.length) throw notFound("Conversation");
  return { ok: true };
});
