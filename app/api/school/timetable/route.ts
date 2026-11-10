import { z } from "zod";
import { route } from "@/lib/api";
import { LessonInput, addLesson, listLessons } from "@/services/school/school";

const Q = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) });

export const GET = route({ query: Q }, async ({ db, user, query }) => ({ items: await listLessons(db, user.id, new Date(query.from), new Date(query.to)) }));
export const POST = route({ body: LessonInput }, async ({ db, user, body }) => addLesson(db, user.id, body));
