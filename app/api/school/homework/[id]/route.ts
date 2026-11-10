import { after } from "next/server";
import { syncSchoolCalendar } from "@/services/school/gcal";
import { z } from "zod";
import { route, zId } from "@/lib/api";
import { deleteManual, setHomeworkDone } from "@/services/school/school";

export const PATCH = route({ body: z.object({ done: z.boolean() }) }, async ({ db, user, params, body }) => {
  const r = await setHomeworkDone(db, user.id, zId.parse(params.id), body.done);
  after(() => syncSchoolCalendar(db, user.id).catch(() => null));
  return r;
});
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteManual(db, user.id, "homework", zId.parse(params.id));
  after(() => syncSchoolCalendar(db, user.id).catch(() => null));
  return { ok: true };
});
