import { z } from "zod";
import { eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { universalSearch, SEARCH_TYPES } from "@/services/search";

const Q = z.object({
  q: z.string().max(200).default(""),
  types: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
  remember: z.enum(["1"]).optional(),
});

export const GET = route({ query: Q, rate: [120, 60_000] }, async ({ db, user, query }) => {
  const types = query.types?.split(",").filter((t): t is (typeof SEARCH_TYPES)[number] => (SEARCH_TYPES as string[]).includes(t));
  const hits = await universalSearch(db, user.id, query.q, { types, limit: query.limit });
  if (query.remember && query.q.trim().length > 1) {
    const [p] = await db.select({ r: schema.userPreferences.recentSearches }).from(schema.userPreferences).where(eq(schema.userPreferences.userId, user.id));
    const recent = [query.q.trim(), ...(p?.r ?? []).filter((x) => x !== query.q.trim())].slice(0, 8);
    await db.update(schema.userPreferences).set({ recentSearches: recent }).where(eq(schema.userPreferences.userId, user.id));
  }
  return { hits };
});
