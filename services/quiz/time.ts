/**
 * Calendrier des quiz : heures locales de l'utilisateur (fuseau du profil) et créneaux de proposition.
 * Fonctions pures, sans accès à la base.
 */

export type LocalNow = { date: string; hour: number; minute: number; weekday: number };
export type Hours = { weekdayHour: number; wednesdayHour: number; weekendHour: number };
export type Stage = "j7" | "j3" | "j1";

/** Étapes de révision avant une évaluation, de la plus proche à la plus lointaine. */
export const STAGES: { stage: Stage; days: number; label: string }[] = [
  { stage: "j1", days: 1, label: "Veille" },
  { stage: "j3", days: 3, label: "J-3" },
  { stage: "j7", days: 7, label: "J-7" },
];

/** Jours avant l'évaluation pour une étape (99 si inconnue). */
export const stageDays = (stage: string) => STAGES.find((s) => s.stage === stage)?.days ?? 99;

function parts(at: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), s: Number(p.second) };
}

/** Date, heure et jour de la semaine (0 = dimanche) dans le fuseau donné. */
export function localNow(tz: string, now = new Date()): LocalNow {
  const p = parts(now, tz);
  const date = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  return { date, hour: p.h, minute: p.min, weekday: weekdayOf(date) };
}

export function shiftDate(date: string, n: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function weekdayOf(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function mondayOf(date: string) {
  return shiftDate(date, -((weekdayOf(date) + 6) % 7));
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** Instant correspondant à minuit (heure locale) du jour donné. */
export function zonedMidnight(date: string, tz: string) {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const p = parts(new Date(utc), tz);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - utc;
  return new Date(utc - offset);
}

export const isWeekend = (weekday: number) => weekday === 0 || weekday === 6;

/** Heure à partir de laquelle le quiz est proposé : mercredi après-midi, week-end le matin, sinon le soir. */
export function slotHour(weekday: number, h: Hours) {
  return weekday === 3 ? h.wednesdayHour : isWeekend(weekday) ? h.weekendHour : h.weekdayHour;
}

/** Le créneau du jour `date` est-il atteint ? */
export function slotReached(date: string, now: LocalNow, h: Hours) {
  return now.date > date || (now.date === date && now.hour >= slotHour(weekdayOf(date), h));
}

/** Étape de révision à proposer maintenant pour une évaluation : la plus proche déjà atteinte, sinon aucune. */
export function dueStage(dueDate: string, now: LocalNow, h: Hours) {
  if (dueDate <= now.date) return null;
  return STAGES.find((s) => slotReached(shiftDate(dueDate, -s.days), now, h)) ?? null;
}
