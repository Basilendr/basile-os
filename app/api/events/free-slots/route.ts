import { z } from "zod";
import { route } from "@/lib/api";
import { findFreeSlots } from "@/services/calendar";

const Q = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  duration: z.coerce.number().int().min(15).max(600),
  dayStart: z.coerce.number().int().min(0).max(23).optional(),
  dayEnd: z.coerce.number().int().min(1).max(24).optional(),
});

export const GET = route({ query: Q }, async ({ db, user, query }) => ({
  slots: await findFreeSlots(db, user.id, { from: new Date(query.from), to: new Date(query.to), durationMin: query.duration, dayStart: query.dayStart, dayEnd: query.dayEnd }),
}));
