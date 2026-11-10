import { route } from "@/lib/api";
import { GradeInput, addGrade, averages, listGrades } from "@/services/school/school";

export const GET = route({}, async ({ db, user }) => {
  const items = await listGrades(db, user.id);
  return { items, averages: averages(items) };
});
export const POST = route({ body: GradeInput }, async ({ db, user, body }) => addGrade(db, user.id, body));
