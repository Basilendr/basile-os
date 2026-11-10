/**
 * Emploi du temps affiché = celui d'École Directe + les modifications connues
 * (messages de la vie scolaire, jours fériés, vacances) + les devoirs et évaluations du jour.
 * Fonctions pures, sans accès à la base.
 */

export type BaseLesson = {
  id: string;
  source: string;
  subject: string;
  subjectCode: string | null;
  teacher: string | null;
  room: string | null;
  startAt: Date;
  endAt: Date;
  cancelled: boolean;
  color: string | null;
  kind: string;
};

export type ChangeRow = {
  id: string;
  source: string; // message | holiday | vacation
  date: string;
  endDate: string;
  action: string; // closed | cancel | change | add | event
  startTime: string | null;
  endTime: string | null;
  matchStart: string | null;
  matchSubject: string | null;
  subject: string | null;
  teacher: string | null;
  room: string | null;
  note: string;
  /** Origine lisible : « M. Y. CASAUX, 8 nov. » ou « Jour férié ». */
  origin: string;
};

export type LessonChange = { kind: "cancelled" | "modified" | "added" | "event"; note: string; origin: string; before?: { subject: string; start: string; end: string; room: string | null; teacher: string | null } };
export type ViewLesson = Omit<BaseLesson, "startAt" | "endAt"> & { startAt: string; endAt: string; change: LessonChange | null; origin?: string };
/** Cours d'une semaine type apprise sur le dernier emploi du temps reçu : clé du créneau École Directe → vrai cours (null = pas un cours de l'élève). */
export type WeekTemplate = Map<string, { subject: string; teacher: string | null; room: string | null; origin: string } | null>;

/** Ni repas, ni pastorale, ni sortie : seulement les matières. */
export const NOT_A_CLASS = /repas|\bself\b|cantine|pastorale|sortie|activit[ée]s? ext[ée]rieure/i;
export type DayEvent = { date: string; title: string; kind: "holiday" | "vacation" | "closed" | "event"; startTime: string | null; endTime: string | null; origin: string };

/* ---------------------------------------------------------------- matières */

const STOP = new Set(["ens", "spe", "specialite", "enseignement", "lv1", "lv2", "lva", "lvb", "de", "la", "le", "les", "et", "du", "des", "d", "l", "sc", "sci"]);
const GROUPS: [string, string[]][] = [
  ["hggsp", ["hggsp", "geopolitique"]],
  ["ses", ["ses", "econo", "economiques sociales", "economie"]],
  ["svt", ["svt", "vie terre"]],
  ["maths", ["maths", "math", "mathematiques"]],
  ["hg", ["histoire", "geographie", "hist geo", "hi ge"]],
  ["emc", ["emc", "moral civique"]],
  ["eps", ["eps", "physique sport", "education physique"]],
  ["pc", ["physique chimie", "ph ch"]],
  ["fr", ["francais", "franc"]],
  ["en", ["anglais", "agl"]],
  ["es", ["espagnol", "esp"]],
  ["de", ["allemand"]],
  ["hlp", ["hlp", "hlphi", "humanites", "philosophie", "philo"]],
];

export function subjectWords(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .join(" ");
}

export function subjectGroup(s: string) {
  const w = ` ${subjectWords(s)} `;
  for (const [g, aliases] of GROUPS) if (aliases.some((a) => w.includes(` ${a} `) || w.includes(` ${a}`))) return g;
  return w.trim();
}

/** « SC. ECONO.& SOCIALES », « ENS SPE SES » et « SES » désignent la même matière. */
export function sameSubject(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const ga = subjectGroup(a);
  const gb = subjectGroup(b);
  return !!ga && ga === gb;
}

/* ---------------------------------------------------------------- heures locales */

export function localParts(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

const toMin = (hm: string | null | undefined) => {
  const m = /^(\d{1,2})[:h](\d{2})?$/.exec((hm ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null;
};
export const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Instant correspondant à `date` à `minutes` après minuit, heure locale. */
export function atLocal(date: string, minutes: number, tz: string) {
  const guess = new Date(`${date}T00:00:00Z`).getTime() + minutes * 60_000;
  const p = localParts(new Date(guess), tz);
  const shift = (Date.parse(`${p.date}T00:00:00Z`) + p.minutes * 60_000 - guess) / 60_000;
  return new Date(guess - shift * 60_000);
}

function* days(from: string, to: string) {
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) yield d;
}

/* ---------------------------------------------------------------- emploi du temps de la semaine reçu */

type Work = ViewLesson & { date: string; s: number; e: number };

/** Noms de famille d'un ou plusieurs professeurs (« JUILLARD C. SANCHEZ M. » → juillard, sanchez). */
const teacherNames = (t: string | null | undefined) => subjectWords(t ?? "").split(" ").filter((w) => w.length >= 3);
const sameTeacher = (a: string | null | undefined, b: string | null | undefined) => {
  const x = teacherNames(a);
  return x.length > 0 && teacherNames(b).some((w) => x.includes(w));
};
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** Créneau École Directe qui revient chaque semaine : jour, heure, intitulé, professeur. */
const slotKey = (l: { date: string; s: number; subject: string; teacher: string | null }) => `${weekday(l.date)}|${hm(l.s)}|${subjectWords(l.subject)}|${teacherNames(l.teacher).join(" ")}`;

type Slot = { row: ChangeRow; s: number; e: number };

/**
 * Cours d'une journée d'après l'emploi du temps reçu, calés sur les horaires exacts d'École Directe
 * (la grille du PDF n'est pas régulière). Renvoie aussi, pour chaque cours École Directe, le cours reçu qui lui correspond.
 */
export function matchDay(slots: Slot[], ed: { s: number; e: number; subject: string; teacher: string | null }[]) {
  const pairs: { slot: number; ed: number; d: number }[] = [];
  slots.forEach((p, i) =>
    ed.forEach((l, j) => {
      const d = Math.abs(l.s - p.s);
      const overlap = Math.min(l.e, p.e) - Math.max(l.s, p.s);
      if (sameTeacher(p.row.teacher, l.teacher) ? d <= 45 || overlap > 0 : d <= 10 && overlap > 0) pairs.push({ slot: i, ed: j, d: d + (sameTeacher(p.row.teacher, l.teacher) ? 0 : 30) });
    }),
  );
  const slotToEd = new Map<number, number>();
  const used = new Set<number>();
  for (const p of pairs.sort((a, b) => a.d - b.d)) {
    if (slotToEd.has(p.slot) || used.has(p.ed)) continue;
    slotToEd.set(p.slot, p.ed);
    used.add(p.ed);
  }
  // Deux cours en parallèle (autre groupe de langue, de spécialité, d'EPS) : on garde celui de l'élève, celui qu'École Directe connaît.
  const keep = slots.map((p, i) => {
    if (slotToEd.has(i)) return true;
    return !slots.some((q, k) => k !== i && slotToEd.has(k) && Math.min(p.e, q.e) - Math.max(p.s, q.s) > 10);
  });
  return { slotToEd, keep };
}

/** Semaine type apprise sur les derniers emplois du temps reçus (un jour ordinaire par jour de la semaine, le plus récent). */
export function learnTemplate(ed: BaseLesson[], rows: ChangeRow[], tz: string): WeekTemplate {
  const template: WeekTemplate = new Map();
  const byDate = new Map<string, ChangeRow[]>();
  for (const r of rows) if (r.action === "lesson" || r.action === "week") byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  const closedDays = new Set(rows.filter((r) => r.action === "closed").map((r) => r.date));
  const learned = new Set<number>();
  for (const date of [...byDate.keys()].sort().reverse()) {
    const lessons = byDate.get(date)!.filter((r) => r.action === "lesson");
    // Jour inhabituel (examens, bac blanc, sortie, jour férié) : il n'apprend rien.
    if (learned.has(weekday(date)) || closedDays.has(date) || lessons.length < 2 || lessons.some((r) => /\bbac\b|examen|brevet|\bds\b|devoir surveill|\boral\b|\blibres?\b/i.test(r.subject ?? ""))) continue;
    learned.add(weekday(date));
    const slots = lessons.map((row) => ({ row, s: toMin(row.startTime) ?? 0, e: toMin(row.endTime) ?? 0 }));
    const day = ed
      .filter((l) => l.source === "ecoledirecte" && localParts(l.startAt, tz).date === date && !NOT_A_CLASS.test(l.subject))
      .map((l) => ({ ...l, date, s: localParts(l.startAt, tz).minutes, e: localParts(l.endAt, tz).minutes }));
    const { slotToEd, keep } = matchDay(slots, day);
    const matched = new Set<number>();
    slots.forEach((p, i) => {
      const j = slotToEd.get(i);
      if (j === undefined || !keep[i]) return;
      matched.add(j);
      template.set(slotKey(day[j]), { subject: p.row.subject ?? day[j].subject, teacher: p.row.teacher ?? day[j].teacher, room: p.row.room, origin: p.row.origin });
    });
    day.forEach((l, j) => {
      if (!matched.has(j) && !template.has(slotKey(l))) template.set(slotKey(l), null);
    });
  }
  return template;
}

/* ---------------------------------------------------------------- application des modifications */

export function applyChanges(lessons: BaseLesson[], changes: ChangeRow[], tz: string, template: WeekTemplate = new Map()): { lessons: ViewLesson[]; days: DayEvent[] } {
  const all: Work[] = lessons
    .filter((l) => !NOT_A_CLASS.test(l.subject))
    .map((l) => {
      const a = localParts(l.startAt, tz);
      const b = localParts(l.endAt, tz);
      return { ...l, startAt: l.startAt.toISOString(), endAt: l.endAt.toISOString(), change: l.cancelled ? { kind: "cancelled", note: "Annulé sur École Directe", origin: "École Directe" } : null, date: a.date, s: a.minutes, e: b.date === a.date ? b.minutes : 24 * 60 };
    });

  // Jours couverts par un emploi du temps reçu : ses cours remplacent ceux d'École Directe.
  const weekRows = changes.filter((c) => c.action === "lesson" || c.action === "week");
  const covered = new Set(weekRows.map((c) => c.date));
  const list: Work[] = [];
  for (const date of covered) {
    const ed = all.filter((l) => l.date === date && l.source === "ecoledirecte");
    const slots = weekRows
      .filter((c) => c.date === date && c.action === "lesson" && !NOT_A_CLASS.test(c.subject ?? ""))
      .map((row) => ({ row, s: toMin(row.startTime) ?? -1, e: toMin(row.endTime) ?? -1 }))
      .filter((p) => p.s >= 0 && p.e > p.s);
    const { slotToEd, keep } = matchDay(slots, ed);
    slots.forEach((p, i) => {
      if (!keep[i]) return;
      const l = slotToEd.has(i) ? ed[slotToEd.get(i)!] : null;
      const s = l?.s ?? p.s;
      const e = l?.e ?? p.e;
      list.push({
        id: `wk-${p.row.id}`,
        source: "week",
        subject: p.row.subject || l?.subject || "Cours",
        subjectCode: null,
        teacher: p.row.teacher ?? l?.teacher ?? null,
        room: p.row.room ?? l?.room ?? null,
        startAt: atLocal(date, s, tz).toISOString(),
        endAt: atLocal(date, e, tz).toISOString(),
        cancelled: false,
        color: null,
        kind: "COURS",
        change: null,
        origin: p.row.origin,
        date,
        s,
        e,
      });
    });
  }
  // Les autres jours : cours d'École Directe, corrigés d'après la semaine type (vrai intitulé, cours des autres groupes retirés).
  for (const l of all) {
    if (l.source === "ecoledirecte" && covered.has(l.date)) continue;
    const t = l.source === "ecoledirecte" ? template.get(slotKey(l)) : undefined;
    if (t === null) continue;
    list.push(t ? { ...l, subject: t.subject, subjectCode: null, teacher: t.teacher ?? l.teacher, room: t.room ?? l.room, origin: t.origin } : l);
  }
  changes = changes.filter((c) => c.action !== "lesson" && c.action !== "week");
  const out: DayEvent[] = [];
  // Ordre : fermetures, puis annulations et modifications, puis ajouts ; à date égale, le message le plus récent l'emporte.
  const order = { closed: 0, cancel: 1, change: 2, add: 3, event: 3 } as Record<string, number>;
  // Jours fériés et vacances d'abord : leur libellé officiel prime sur un « Férié » annoncé par message.
  const official = (c: ChangeRow) => (c.source === "holiday" || c.source === "vacation" ? 0 : 1);
  const sorted = [...changes].sort((a, b) => (order[a.action] ?? 9) - (order[b.action] ?? 9) || official(a) - official(b));

  const targets = (date: string, at: number | null, subject: string | null) => {
    const sameDay = list.filter((l) => l.date === date && l.source !== "change" && l.change?.kind !== "cancelled");
    const byTime = at === null ? sameDay : sameDay.filter((l) => Math.abs(l.s - at) <= 20 || (at >= l.s && at < l.e));
    // Sans matière, seul un créneau précis désigne des cours (tous ceux de ce créneau).
    if (!subject) return at === null ? [] : byTime;
    const both = byTime.filter((l) => sameSubject(l.subject, subject) || sameSubject(l.subjectCode, subject));
    if (both.length) return both;
    // Créneau sans matière reconnue : on ne touche qu'à un cours seul sur ce créneau.
    if (at !== null && byTime.length === 1) return byTime;
    // Matière sans créneau précis : le seul cours de cette matière dans la journée.
    const bySubject = sameDay.filter((l) => sameSubject(l.subject, subject) || sameSubject(l.subjectCode, subject));
    return at === null ? bySubject : bySubject.length === 1 ? bySubject : [];
  };

  const addBlock = (c: ChangeRow, date: string, kind: "added" | "event") => {
    const s = toMin(c.startTime);
    const e = toMin(c.endTime) ?? (s !== null ? s + 55 : null);
    if (s === null || e === null || e <= s) return false;
    list.push({
      id: `chg-${c.id}-${date}`,
      source: "change",
      subject: c.subject || c.note || "Modification",
      subjectCode: null,
      teacher: c.teacher,
      room: c.room,
      startAt: atLocal(date, s, tz).toISOString(),
      endAt: atLocal(date, e, tz).toISOString(),
      cancelled: false,
      color: null,
      kind: kind === "event" ? "EVENT" : "COURS",
      change: { kind, note: c.note, origin: c.origin },
      date,
      s,
      e,
    });
    return true;
  };

  for (const c of sorted) {
    for (const date of days(c.date, c.endDate)) {
      if (c.action === "closed") {
        const s = toMin(c.startTime);
        const e = toMin(c.endTime);
        const title = c.subject || c.note || (c.source === "holiday" ? "Jour férié" : c.source === "vacation" ? "Vacances" : "Pas cours");
        for (const l of list) {
          if (l.date !== date || l.source === "change") continue;
          if (s !== null && e !== null && (l.e <= s || l.s >= e)) continue;
          if (l.cancelled && l.change && l.change.origin !== "École Directe") continue;
          l.cancelled = true;
          l.change = { kind: "cancelled", note: title, origin: c.origin };
        }
        // Une fermeture sur quelques heures (sortie, examen) s'affiche comme un bloc ; sinon comme un bandeau du jour.
        if (s === null || e === null || e - s >= 8 * 60 || !addBlock(c, date, "event")) out.push({ date, title, kind: c.source === "holiday" ? "holiday" : c.source === "vacation" ? "vacation" : "closed", startTime: c.startTime, endTime: c.endTime, origin: c.origin });
        continue;
      }
      if (c.action === "cancel") {
        for (const l of targets(date, toMin(c.matchStart ?? c.startTime), c.matchSubject ?? c.subject)) {
          l.cancelled = true;
          l.change = { kind: "cancelled", note: c.note || "Cours annulé", origin: c.origin };
        }
        continue;
      }
      if (c.action === "change") {
        const found = targets(date, toMin(c.matchStart ?? c.startTime), c.matchSubject ?? c.subject);
        if (!found.length) {
          addBlock(c, date, "added");
          continue;
        }
        for (const l of found) {
          const before = { subject: l.subject, start: hm(l.s), end: hm(l.e), room: l.room, teacher: l.teacher };
          const s = toMin(c.startTime) ?? l.s;
          const e = toMin(c.endTime) ?? (toMin(c.startTime) !== null ? s + (l.e - l.s) : l.e);
          Object.assign(l, {
            subject: c.subject || l.subject,
            teacher: c.teacher ?? l.teacher,
            room: c.room ?? l.room,
            s,
            e,
            startAt: atLocal(date, s, tz).toISOString(),
            endAt: atLocal(date, e, tz).toISOString(),
            change: { kind: "modified", note: c.note, origin: c.origin, before },
          });
        }
        continue;
      }
      if (!addBlock(c, date, c.action === "event" ? "event" : "added")) out.push({ date, title: c.subject || c.note || "Événement", kind: "event", startTime: c.startTime, endTime: c.endTime, origin: c.origin });
    }
  }
  // Un « Férié » annoncé par message double le jour férié déjà connu : on garde le plus précis.
  const officialDays = new Set(out.filter((d) => d.kind === "holiday" || d.kind === "vacation").map((d) => d.date));
  const seen = new Set<string>();
  const dayEvents = out
    .filter((d) => {
      const k = `${d.date}:${d.title}`;
      if (seen.has(k) || (d.kind === "closed" && officialDays.has(d.date) && /f[ée]ri[ée]|vacances|cong[ée]/i.test(d.title))) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return { lessons: list.sort((a, b) => a.startAt.localeCompare(b.startAt)).map(({ date: _d, s: _s, e: _e, ...l }) => l), days: dayEvents };
}

/** Rattache chaque devoir au premier cours de sa matière le jour où il est dû. */
export function lessonFor(h: { subject: string; subjectCode: string | null; dueDate: string }, lessons: ViewLesson[], tz: string) {
  const sameDay = lessons.filter((l) => !l.cancelled && localParts(new Date(l.startAt), tz).date === h.dueDate);
  return (sameDay.find((l) => h.subjectCode && l.subjectCode === h.subjectCode) ?? sameDay.find((l) => sameSubject(l.subject, h.subject)))?.id ?? null;
}
