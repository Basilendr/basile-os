import { z } from "zod";
import { route } from "@/lib/api";
import { streamTurn } from "@/services/ai/chat";

const Body = z.object({
  conversationId: z.uuid().nullable().optional(),
  kind: z.enum(["assistant", "command"]).default("assistant"),
  message: z.string().trim().min(1).max(20_000),
  page: z.object({ path: z.string().max(300).optional(), entityType: z.string().max(40).optional(), entityId: z.string().max(200).optional(), title: z.string().max(300).optional() }).optional(),
});

export const POST = route({ body: Body, rate: [30, 60_000] }, async ({ db, user, body, req }) =>
  new Response(streamTurn(db, user.id, body, req.signal), { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } }),
);
