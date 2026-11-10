import { z } from "zod";
import { route } from "@/lib/api";
import { dashboard } from "@/services/dashboard";

const Q = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), days: z.coerce.number().int().min(1).max(365).default(7) });

export const GET = route({ query: Q }, async ({ db, user, query }) => dashboard(db, user.id, { from: new Date(query.from), to: new Date(query.to) }, query.days));
