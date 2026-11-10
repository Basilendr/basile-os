import { z } from "zod";
import { route } from "@/lib/api";
import { KnowledgeInput, createKnowledge, listKnowledge } from "@/services/brain";

export const GET = route({ query: z.object({ kind: z.string().max(20).optional() }) }, async ({ db, user, query }) => ({ items: await listKnowledge(db, user.id, query.kind) }));
export const POST = route({ body: KnowledgeInput }, async ({ db, user, body }) => createKnowledge(db, user.id, body));
