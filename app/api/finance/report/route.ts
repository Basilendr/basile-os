import { z } from "zod";
import { route } from "@/lib/api";
import { report } from "@/services/finance";

export const GET = route({ query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }) }, async ({ db, user, query }) => report(db, user.id, query.month));
