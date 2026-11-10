import { after } from "next/server";
import { z } from "zod";
import { route } from "@/lib/api";
import { LessonInput, addLesson } from "@/services/school/school";
import { syncSchoolCalendar } from "@/services/school/gcal";
import { timetableView } from "@/services/school/timetable";

const Q = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) });

/** Emploi du temps à jour : cours, modifications, fériés et vacances, devoirs et évaluations. */
export const GET = route({ query: Q }, async ({ db, user, query }) => timetableView(db, user.id, new Date(query.from), new Date(query.to)));
export const POST = route({ body: LessonInput }, async ({ db, user, body }) => {
  const r = await addLesson(db, user.id, body);
  after(() => syncSchoolCalendar(db, user.id).catch(() => null));
  return r;
});
