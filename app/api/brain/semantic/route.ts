import { z } from "zod";
import { route } from "@/lib/api";
import { semanticSearch } from "@/services/ai/embeddings";
import { resolveEntities } from "@/services/brain";

export const GET = route({ query: z.object({ q: z.string().min(2).max(500) }), rate: [30, 60_000] }, async ({ db, user, query }) => {
  const hits = await semanticSearch(db, user.id, query.q, { limit: 12 });
  const res = await resolveEntities(db, user.id, hits.map((h) => ({ type: h.entityType, id: h.entityId })));
  return { items: hits.map((h) => ({ ...h, ...(res.get(`${h.entityType}:${h.entityId}`) ?? { title: "(supprimé)", href: "/brain" }), excerpt: h.content.slice(0, 280) })) };
});
