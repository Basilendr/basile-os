import { route } from "@/lib/api";
import { runTimetableAgent } from "@/services/school/agent";
import { syncSchoolCalendar } from "@/services/school/gcal";
import { refreshSchoolDays } from "@/services/school/timetable";

/** « Vérifier les messages » : l'agent lit tout de suite les messages pas encore analysés. */
export const POST = route({ rate: [6, 60_000] }, async ({ db, user }) => {
  await refreshSchoolDays(db, user.id);
  const r = await runTimetableAgent(db, user.id, { days: 21 });
  await syncSchoolCalendar(db, user.id).catch(() => null);
  return r;
});
