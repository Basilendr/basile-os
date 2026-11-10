import { z } from "zod";
import { route } from "@/lib/api";
import { geocode } from "@/services/weather";

export const GET = route({ query: z.object({ q: z.string().trim().min(2).max(100) }), rate: [30, 60_000] }, async ({ query }) => ({ items: await geocode(query.q) }));
