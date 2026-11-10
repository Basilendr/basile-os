import { and, eq } from "drizzle-orm";
import { route, zId } from "@/lib/api";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { KnowledgeInput, deleteKnowledge, linksOf, updateKnowledge } from "@/services/brain";

export const GET = route({}, async ({ db, user, params }) => {
  const id = zId.parse(params.id);
  const [k] = await db.select().from(schema.knowledgeItems).where(and(eq(schema.knowledgeItems.id, id), eq(schema.knowledgeItems.userId, user.id)));
  if (!k) throw notFound("Élément");
  return { ...k, links: await linksOf(db, user.id, "knowledge", id) };
});
export const PATCH = route({ body: KnowledgeInput.partial() }, async ({ db, user, params, body }) => updateKnowledge(db, user.id, zId.parse(params.id), body));
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteKnowledge(db, user.id, zId.parse(params.id));
  return { ok: true };
});
