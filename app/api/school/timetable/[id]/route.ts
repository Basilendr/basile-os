import { after } from "next/server";
import { syncSchoolCalendar } from "@/services/school/gcal";
import { route, zId } from "@/lib/api";
import { deleteManual } from "@/services/school/school";

export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteManual(db, user.id, "lesson", zId.parse(params.id));
  after(() => syncSchoolCalendar(db, user.id).catch(() => null));
  return { ok: true };
});
