import { z } from "zod";
import { route } from "@/lib/api";
import { setSchoolCalendar, syncSchoolCalendar } from "@/services/school/gcal";

/** Agenda Google « École » : synchroniser maintenant, ou l'activer / le couper. */
export const POST = route({ rate: [6, 60_000] }, async ({ db, user }) => syncSchoolCalendar(db, user.id));
export const PUT = route({ body: z.object({ enabled: z.boolean() }) }, async ({ db, user, body }) => setSchoolCalendar(db, user.id, body.enabled));
