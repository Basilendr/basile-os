import { z } from "zod";
import { route } from "@/lib/api";
import { recentActivity } from "@/services/activity";

export const GET = route({ query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(30) }) }, async ({ db, user, query }) => ({
  items: await recentActivity(db, user.id, query.limit),
}));
