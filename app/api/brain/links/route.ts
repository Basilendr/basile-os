import { z } from "zod";
import { route } from "@/lib/api";
import { ENTITY_TYPES, LinkInput, link, linksOf } from "@/services/brain";

export const GET = route({ query: z.object({ type: z.enum(ENTITY_TYPES), id: z.string().max(200) }) }, async ({ db, user, query }) => ({ items: await linksOf(db, user.id, query.type, query.id) }));
export const POST = route({ body: LinkInput }, async ({ db, user, body }) => link(db, user.id, body));
