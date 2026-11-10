/**
 * Jours fériés (calculés) et vacances scolaires (calendrier officiel de l'Éducation nationale).
 * Fonctions pures, sans accès à la base.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const add = (date: string, n: number) => iso(new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000));

/** Dimanche de Pâques (algorithme de Meeus). */
export function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Jours fériés en France métropolitaine. */
export function publicHolidays(year: number): { date: string; name: string }[] {
  const e = easter(year);
  return [
    { date: `${year}-01-01`, name: "Jour de l'an" },
    { date: add(e, 1), name: "Lundi de Pâques" },
    { date: `${year}-05-01`, name: "Fête du Travail" },
    { date: `${year}-05-08`, name: "Victoire 1945" },
    { date: add(e, 39), name: "Ascension" },
    { date: add(e, 50), name: "Lundi de Pentecôte" },
    { date: `${year}-07-14`, name: "Fête nationale" },
    { date: `${year}-08-15`, name: "Assomption" },
    { date: `${year}-11-01`, name: "Toussaint" },
    { date: `${year}-11-11`, name: "Armistice 1918" },
    { date: `${year}-12-25`, name: "Noël" },
  ];
}

export type Vacation = { name: string; date: string; endDate: string };
type Record = { description: string; population: string; start_date: string; end_date: string };

/** Date locale (Paris) d'un instant ISO. */
const parisDate = (s: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s));

/**
 * Vacances d'une académie, d'après le jeu de données officiel. `end_date` y est le jour de la reprise :
 * le dernier jour de vacances est la veille. Seules les dates des élèves sont gardées.
 */
export function parseVacations(records: Record[]): Vacation[] {
  const out = new Map<string, Vacation>();
  for (const r of records) {
    if (r.population && !["-", "Élèves", "Eleves"].includes(r.population)) continue;
    const date = parisDate(r.start_date);
    const reprise = parisDate(r.end_date);
    // Le jeu de données donne parfois le début la veille au soir (vendredi) : les vacances commencent le samedi.
    const start = new Date(`${date}T12:00:00Z`).getUTCDay() === 5 ? add(date, 1) : date;
    const endDate = reprise > start ? add(reprise, -1) : start;
    out.set(`${r.description}:${start}`, { name: r.description, date: start, endDate });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Années scolaires couvrant une date (ex. « 2026-2027 ») : l'année en cours et la suivante. */
export function schoolYears(today: string) {
  const y = Number(today.slice(0, 4));
  const start = Number(today.slice(5, 7)) >= 8 ? y : y - 1;
  return [`${start}-${start + 1}`, `${start + 1}-${start + 2}`];
}

/** Vacances scolaires de l'académie (Paris : zone C). */
export async function fetchVacations(today: string, location = "Paris"): Promise<Vacation[]> {
  const years = schoolYears(today);
  const where = `location="${location}" AND (${years.map((y) => `annee_scolaire="${y}"`).join(" OR ")})`;
  const url = `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?where=${encodeURIComponent(where)}&limit=50`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Calendrier scolaire indisponible (${res.status})`);
  const j = (await res.json()) as { results?: Record[] };
  return parseVacations(j.results ?? []);
}
