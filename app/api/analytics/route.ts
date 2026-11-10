import { z } from "zod";
import { route } from "@/lib/api";
import { analytics } from "@/services/analytics";

export const GET = route({ query: z.object({ period: z.enum(["7d", "30d", "90d", "12m"]).default("30d") }) }, async ({ db, user, query }) => analytics(db, user.id, query.period));
