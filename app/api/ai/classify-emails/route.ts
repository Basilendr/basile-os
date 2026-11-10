import { z } from "zod";
import { route } from "@/lib/api";
import { classifyEmails } from "@/services/ai/transform";

export const POST = route({ body: z.object({ ids: z.array(z.string().max(64)).max(30).optional() }), rate: [10, 60_000] }, async ({ db, user, body }) => classifyEmails(db, user.id, body.ids));
