import { z } from "zod";
import { route } from "@/lib/api";
import { syncCalendar } from "@/services/google/calendar";
import { syncGmail } from "@/services/google/gmail";

export const POST = route({ body: z.object({ service: z.enum(["gmail", "calendar"]) }), rate: [12, 60_000] }, async ({ db, user, body }) =>
  body.service === "gmail" ? syncGmail(db, user.id) : syncCalendar(db, user.id),
);
