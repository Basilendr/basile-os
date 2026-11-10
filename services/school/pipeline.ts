import "server-only";
import type { DB } from "@/lib/db";
import { log } from "@/lib/log";
import { runTimetableAgent } from "./agent";
import { syncSchoolCalendar } from "./gcal";
import { refreshSchoolDays } from "./timetable";

/**
 * Après chaque synchronisation d'École Directe : fériés et vacances à jour, messages de la vie scolaire analysés
 * par l'agent emploi du temps, puis agenda Google « École » mis au niveau. Chaque étape est indépendante.
 */
export async function afterSchoolSync(db: DB, userId: string) {
  await refreshSchoolDays(db, userId).catch((e) => log.warn("school.days_failed", { error: String(e) }));
  await runTimetableAgent(db, userId).catch((e) => log.warn("school.agent_failed", { error: String(e) }));
  await syncSchoolCalendar(db, userId).catch((e) => log.warn("school.gcal_failed", { error: String(e) }));
}
