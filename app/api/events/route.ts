import { z } from "zod";
import { route } from "@/lib/api";
import { EventInput, createEvent, listEvents } from "@/services/calendar";

const Q = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) });

export const GET = route({ query: Q }, async ({ db, user, query }) => ({ items: await listEvents(db, user.id, new Date(query.from), new Date(query.to)) }));
export const POST = route({ body: EventInput }, async ({ db, user, body }) => createEvent(db, user.id, body));
