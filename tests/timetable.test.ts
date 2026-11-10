import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { setup } from "./helpers";

process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";

let db: DB;
let userId: string;
const TZ = "Europe/Paris";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

beforeAll(async () => {
  ({ db, userId } = await setup());
});
afterEach(() => vi.unstubAllGlobals());

describe("jours fériés et vacances", () => {
  it("calcule Pâques, les fériés et lit le calendrier scolaire officiel", async () => {
    const { easter, publicHolidays, parseVacations, schoolYears } = await import("@/services/school/days");
    expect(easter(2026)).toBe("2026-04-05");
    expect(easter(2027)).toBe("2027-03-28");
    const h = publicHolidays(2027);
    expect(h.find((x) => x.name === "Ascension")?.date).toBe("2027-05-06");
    expect(h.find((x) => x.name === "Lundi de Pentecôte")?.date).toBe("2027-05-17");
    expect(h.find((x) => x.name === "Armistice 1918")?.date).toBe("2027-11-11");
    expect(schoolYears("2026-11-10")).toEqual(["2026-2027", "2027-2028"]);
    expect(schoolYears("2027-03-01")).toEqual(["2026-2027", "2027-2028"]);
    const v = parseVacations([
      { description: "Vacances de Noël", population: "-", start_date: "2026-12-18T23:00:00+00:00", end_date: "2027-01-03T23:00:00+00:00" },
      { description: "Vacances d'Été", population: "Enseignants", start_date: "2027-07-02T22:00:00+00:00", end_date: "2027-08-31T22:00:00+00:00" },
      { description: "Vacances de la Toussaint", population: "-", start_date: "2026-10-16T22:00:00+00:00", end_date: "2026-11-01T23:00:00+00:00" },
    ]);
    expect(v).toEqual([
      { name: "Vacances de la Toussaint", date: "2026-10-17", endDate: "2026-11-01" },
      { name: "Vacances de Noël", date: "2026-12-19", endDate: "2027-01-03" },
    ]);
  });
});

describe("modifications de l'emploi du temps", () => {
  const at = (date: string, hm: string) => new Date(`${date}T${hm}:00+01:00`);
  const lesson = (id: string, subject: string, date: string, start: string, end: string, extra: Partial<{ teacher: string; subjectCode: string; room: string }> = {}) => ({ id, source: "ecoledirecte", subject, subjectCode: extra.subjectCode ?? null, teacher: extra.teacher ?? null, room: extra.room ?? null, startAt: at(date, start), endAt: at(date, end), cancelled: false, color: null, kind: "COURS" });
  const change = (o: Partial<import("@/services/school/overlay").ChangeRow>) => ({ id: Math.random().toString(36).slice(2), source: "message", date: "2026-11-12", endDate: o.date ?? "2026-11-12", action: "cancel", startTime: null, endTime: null, matchStart: null, matchSubject: null, subject: null, teacher: null, room: null, note: "", origin: "Message de M. Y. CASAUX du 8 nov.", ...o });
  const week = [
    lesson("ses", "SC. ECONO.& SOCIALES", "2026-11-10", "10:00", "10:55", { subjectCode: "SES" }),
    lesson("fr", "FRANCAIS", "2026-11-10", "14:00", "15:50"),
    lesson("ses2", "SC. ECONO.& SOCIALES", "2026-11-11", "08:30", "09:50"),
    lesson("maths", "SPECIALITE MATHS", "2026-11-12", "10:00", "11:55"),
    lesson("pc", "PHYSIQUE-CHIMIE", "2026-11-12", "12:00", "13:00"),
    lesson("svt", "SCIENCES VIE & TERRE", "2026-11-13", "08:30", "10:20", { teacher: "MENCIASSI I." }),
  ];

  it("reconnaît une même matière sous plusieurs noms", async () => {
    const { sameSubject } = await import("@/services/school/overlay");
    expect(sameSubject("SC. ECONO.& SOCIALES", "ENS SPE SES")).toBe(true);
    expect(sameSubject("SCIENCES VIE & TERRE", "ENS SCI SVT")).toBe(true);
    expect(sameSubject("SPECIALITE MATHS", "Mathématiques")).toBe(true);
    expect(sameSubject("HISTOIRE-GEOGRAPHIE", "ENS SPE HGGSP")).toBe(false);
    expect(sameSubject("ESPAGNOL LV2", "Espagnol")).toBe(true);
    expect(sameSubject("FRANCAIS", "ANGLAIS")).toBe(false);
  });

  it("applique fériés, sortie, annulation, étude et ajout ; un férié annoncé ne double pas le férié connu", async () => {
    const { applyChanges } = await import("@/services/school/overlay");
    const v = applyChanges(
      week,
      [
        change({ source: "holiday", date: "2026-11-11", endDate: "2026-11-11", action: "closed", subject: "Férié · Armistice 1918", origin: "Jour férié" }),
        change({ date: "2026-11-11", endDate: "2026-11-11", action: "closed", subject: "Férié" }),
        change({ date: "2026-11-12", action: "closed", subject: "Sortie pédagogique" }),
        change({ date: "2026-11-10", endDate: "2026-11-10", action: "change", matchStart: "10:00", matchSubject: "ENS SPE SES", startTime: "10:00", endTime: "11:00", subject: "Étude (SES)", room: "Foyer", note: "Spé SES en étude" }),
        change({ date: "2026-11-10", endDate: "2026-11-10", action: "cancel", matchStart: "14:00", matchSubject: "FRANCAIS", note: "Professeur absent" }),
        change({ date: "2026-11-13", endDate: "2026-11-13", action: "add", startTime: "16:00", endTime: "17:00", subject: "Devoir surveillé" }),
      ],
      TZ,
    );
    const byId = Object.fromEntries(v.lessons.map((l) => [l.id, l]));
    expect(byId.ses).toMatchObject({ subject: "Étude (SES)", room: "Foyer", cancelled: false, change: { kind: "modified", before: { subject: "SC. ECONO.& SOCIALES", start: "10:00", end: "10:55" } } });
    expect(new Date(byId.ses.endAt).toISOString()).toBe("2026-11-10T10:00:00.000Z");
    expect(byId.fr).toMatchObject({ cancelled: true, change: { kind: "cancelled", note: "Professeur absent" } });
    expect(byId.ses2).toMatchObject({ cancelled: true, change: { note: "Férié · Armistice 1918" } });
    expect(byId.maths.cancelled && byId.pc.cancelled).toBe(true);
    expect(byId.svt.cancelled).toBe(false);
    const added = v.lessons.find((l) => l.subject === "Devoir surveillé")!;
    expect(added).toMatchObject({ source: "change", change: { kind: "added" } });
    expect(added.startAt).toBe("2026-11-13T15:00:00.000Z");
    expect(v.days.map((d) => `${d.date} ${d.title}`)).toEqual(["2026-11-11 Férié · Armistice 1918", "2026-11-12 Sortie pédagogique"]);
  });

  it("une fermeture de quelques heures devient un bloc, et un cours introuvable n'est pas annulé au hasard", async () => {
    const { applyChanges } = await import("@/services/school/overlay");
    const v = applyChanges(
      week,
      [
        change({ date: "2026-11-13", endDate: "2026-11-13", action: "closed", startTime: "08:00", endTime: "12:00", subject: "Bac blanc" }),
        change({ date: "2026-11-12", action: "cancel", matchStart: "15:00", matchSubject: "ANGLAIS" }),
      ],
      TZ,
    );
    expect(v.lessons.find((l) => l.id === "svt")?.cancelled).toBe(true);
    expect(v.lessons.find((l) => l.subject === "Bac blanc")).toMatchObject({ kind: "EVENT", change: { kind: "event" } });
    expect(v.days).toEqual([]);
    expect(v.lessons.filter((l) => l.cancelled).map((l) => l.id)).toEqual(["svt"]);
  });

  it("l'emploi du temps reçu remplace celui d'École Directe et corrige les semaines suivantes", async () => {
    const { applyChanges, learnTemplate } = await import("@/services/school/overlay");
    const ed = [
      lesson("a", "SCIENCES VIE & TERRE", "2026-11-09", "08:00", "08:55", { teacher: "MENCIASSI I." }),
      lesson("b", "MATHEMATIQUES", "2026-11-09", "08:00", "08:55", { teacher: "LEFRANC T." }),
      lesson("c", "ANGLAIS", "2026-11-09", "10:00", "10:55", { teacher: "HARTPENCE-RUBINSTEIN S." }),
      lesson("r", "REPAS SELF", "2026-11-09", "12:00", "13:30"),
      lesson("p", "Pastorale", "2026-11-09", "13:30", "14:55"),
    ];
    const pdf = [
      change({ date: "2026-11-09", endDate: "2026-11-09", action: "week" }),
      change({ date: "2026-11-09", endDate: "2026-11-09", action: "lesson", startTime: "08:05", endTime: "08:50", subject: "ENS SPE HGGSP", teacher: "MENCIASSI I.", room: "007" }),
      change({ date: "2026-11-09", endDate: "2026-11-09", action: "lesson", startTime: "10:10", endTime: "11:00", subject: "ANGLAIS", teacher: "HARTPENCE-RUBINSTEIN S." }),
      // Groupe d'allemand en parallèle : pas celui de l'élève.
      change({ date: "2026-11-09", endDate: "2026-11-09", action: "lesson", startTime: "10:10", endTime: "11:00", subject: "ALLEMAND LV2", teacher: "LUZHA S." }),
    ];
    const v = applyChanges(ed, pdf, TZ);
    expect(v.lessons.map((l) => `${l.subject} ${new Date(l.startAt).toISOString().slice(11, 16)}`)).toEqual(["ENS SPE HGGSP 07:00", "ANGLAIS 09:00"]);
    expect(v.lessons[0]).toMatchObject({ source: "week", room: "007", origin: "Message de M. Y. CASAUX du 8 nov." });

    // Semaine suivante sans emploi du temps reçu : intitulé corrigé, cours de l'autre groupe retiré.
    const template = learnTemplate([...ed, lesson("x", "ESPAGNOL", "2026-11-09", "15:00", "16:00")], [...pdf, change({ date: "2026-11-09", endDate: "2026-11-09", action: "lesson", startTime: "15:00", endTime: "16:00", subject: "ESPAGNOL LV2", teacher: null })], TZ);
    const next = applyChanges(
      [lesson("a2", "SCIENCES VIE & TERRE", "2026-11-16", "08:00", "08:55", { teacher: "MENCIASSI I." }), lesson("b2", "MATHEMATIQUES", "2026-11-16", "08:00", "08:55", { teacher: "LEFRANC T." }), lesson("d2", "FRANCAIS", "2026-11-17", "14:00", "15:50")],
      [],
      TZ,
      template,
    );
    expect(next.lessons.map((l) => l.subject)).toEqual(["ENS SPE HGGSP", "FRANCAIS"]);
  });

  it("place un devoir sur le cours de sa matière le jour où il est dû", async () => {
    const { applyChanges, lessonFor } = await import("@/services/school/overlay");
    const v = applyChanges(week, [], TZ);
    expect(lessonFor({ subject: "Physique-chimie", subjectCode: null, dueDate: "2026-11-12" }, v.lessons, TZ)).toBe("pc");
    expect(lessonFor({ subject: "SES", subjectCode: "SES", dueDate: "2026-11-11" }, v.lessons, TZ)).toBe("ses2");
    expect(lessonFor({ subject: "Anglais", subjectCode: null, dueDate: "2026-11-12" }, v.lessons, TZ)).toBeNull();
  });
});

describe("agent emploi du temps et agenda Google", () => {
  it("range le document reçu dans la bonne semaine", async () => {
    const { weekOfDocument } = await import("@/services/school/documents");
    expect(weekOfDocument(new Date("2026-11-08T19:07:05Z"), TZ)).toBe("2026-11-09"); // dimanche soir → semaine suivante
    expect(weekOfDocument(new Date("2026-11-10T07:36:48Z"), TZ)).toBe("2026-11-09"); // mardi → semaine en cours
    expect(weekOfDocument(new Date("2026-11-14T10:00:00Z"), TZ)).toBe("2026-11-16"); // samedi → semaine suivante
  });

  it("ne lit que les messages qui parlent d'emploi du temps", async () => {
    const { worthReading } = await import("@/services/school/agent");
    const casaux = "M. Y. CASAUX";
    expect(worthReading({ fromName: casaux, subject: "1HEHC modifications EDT semaine" }, "1 HE HC")).toBe(true);
    expect(worthReading({ fromName: casaux, subject: "1HEHC spe SES" }, "1 HE HC")).toBe(true);
    expect(worthReading({ fromName: casaux, subject: "Parcours avenir : salon" }, "1 HE HC")).toBe(false);
    expect(worthReading({ fromName: "Mme X", subject: "cours histoire" }, "1 HE HC")).toBe(false);
    expect(worthReading({ fromName: "Mme X", subject: "Cours annulé demain" }, "1 HE HC")).toBe(true);
  });

  it("lit le PDF de la vie scolaire, met l'emploi du temps à jour, puis remplit l'agenda Google « École »", { timeout: 60_000 }, async () => {
    const { setCachedSecret } = await import("@/lib/secrets");
    const { encrypt } = await import("@/lib/crypto");
    const { runTimetableAgent } = await import("@/services/school/agent");
    const { syncSchoolCalendar } = await import("@/services/school/gcal");
    const { timetableView } = await import("@/services/school/timetable");
    setCachedSecret("GEMINI_API_KEY", "AIza-test");
    setCachedSecret("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
    setCachedSecret("GOOGLE_CLIENT_SECRET", "test-secret");
    await db.insert(schema.userPreferences).values({ userId, aiProvider: "gemini", aiModel: "gemini-flash-latest" }).onConflictDoUpdate({ target: schema.userPreferences.userId, set: { aiProvider: "gemini", aiModel: "gemini-flash-latest" } });
    await db.insert(schema.schoolAccounts).values({ userId, username: "eleve", passwordEnc: encrypt("bon-mdp"), tokenEnc: encrypt(JSON.stringify({ token: "t", gtk: "g", cookie: "" })), accountType: "E", studentId: 42, accountId: 42, className: "1 HE HC", status: "connected" });
    const sent = new Date(Date.now() - 3600_000);
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    // Cours d'École Directe demain à 10 h (heure de Paris).
    const tomorrow = day(1);
    await db.insert(schema.schoolLessons).values({ userId, source: "ecoledirecte", externalId: "1", subject: "SC. ECONO.& SOCIALES", subjectCode: "SES", startAt: new Date(`${tomorrow}T10:00:00+01:00`), endAt: new Date(`${tomorrow}T10:55:00+01:00`) });
    await db.insert(schema.schoolHomework).values({ userId, source: "manual", subject: "SES", title: "Contrôle marché", dueDate: tomorrow, isTest: true });
    const [edt] = await db.insert(schema.schoolMessages).values({ userId, externalId: 1, subject: "1HEHC modifications EDT semaine", fromName: "M. Y. CASAUX", date: sent }).returning();
    await db.insert(schema.schoolMessages).values({ userId, externalId: 2, subject: "Parcours avenir : salon", fromName: "M. Y. CASAUX", date: sent });

    const ai: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("ecoledirecte.com") && url.includes("telechargement")) return new Response(Buffer.from("%PDF-1.4 emploi du temps"), { headers: { "content-type": "application/force-download" } });
      if (url.includes("ecoledirecte.com") && /messages\/1\.awp/.test(url)) return new Response(JSON.stringify({ code: 200, token: "t2", data: { content: b64("<p>Je vous invite à prendre connaissance des modifications</p>"), files: [{ id: 5975, libelle: "1HEHC.pdf" }] } }));
      if (url.includes("generativelanguage")) {
        const body = String(init?.body);
        ai.push(body.includes("application/pdf") ? "pdf" : "texte");
        const result = { relevant: true, summary: "Ta spé SES de demain devient une étude au foyer.", coveredDates: [], changes: [{ date: tomorrow, action: "change", start: "10:00", end: "11:00", matchStart: "10:00", matchSubject: "ENS SPE SES", subject: "Étude (SES)", room: "Foyer", note: "Spé SES en étude" }, { date: "1999-01-01", action: "closed", subject: "Hors période" }] };
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } }));
      }
      return new Response("{}", { status: 404 });
    });
    expect(await runTimetableAgent(db, userId)).toEqual({ analysed: 1, changes: 1 });
    expect(ai).toEqual(["pdf"]);
    const msgs = await db.select().from(schema.schoolMessages).where(eq(schema.schoolMessages.userId, userId));
    expect(msgs.find((x) => x.id === edt.id)).toMatchObject({ agentNote: "Ta spé SES de demain devient une étude au foyer.", read: false });
    expect(msgs.find((x) => x.externalId === 2)).toMatchObject({ agentNote: "" });
    const note = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.entityId, edt.id)));
    expect(note[0]?.title).toBe("Emploi du temps mis à jour");
    // Rien de nouveau : pas d'autre appel à l'IA.
    expect(await runTimetableAgent(db, userId)).toEqual({ analysed: 0, changes: 0 });
    expect(ai).toHaveLength(1);

    const view = await timetableView(db, userId, new Date(`${day(0)}T00:00:00Z`), new Date(`${day(3)}T00:00:00Z`));
    expect(view.items[0]).toMatchObject({ subject: "Étude (SES)", room: "Foyer", change: { kind: "modified" } });
    expect(view.homework[0]).toMatchObject({ isTest: true, lessonId: view.items[0].id });
    expect(view.agent?.note).toContain("étude");

    await db.insert(schema.integrations).values({ userId, provider: "google", service: "calendar", status: "connected", scopes: [] });
    await db.insert(schema.oauthTokens).values({ userId, provider: "google", accessTokenEnc: encrypt("at"), refreshTokenEnc: encrypt("rt"), expiresAt: new Date(Date.now() + 3600_000), scopes: ["https://www.googleapis.com/auth/calendar.events"] });

    const google: { method: string; url: string; body?: { summary?: string } }[] = [];
    let n = 0;
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      google.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/calendars") && method === "POST") return new Response(JSON.stringify({ id: "ecole@group.calendar.google.com" }));
      if (method === "POST") return new Response(JSON.stringify({ id: `ev${++n}` }));
      return new Response(method === "DELETE" ? null : "{}", { status: method === "DELETE" ? 204 : 200 });
    });
    // Sans la permission d'agenda séparé : agenda principal, événements marqués.
    expect(await syncSchoolCalendar(db, userId)).toMatchObject({ state: "synced", created: 2 });
    expect(google.filter((r) => r.method === "POST").every((r) => r.url.includes("/calendars/primary/events"))).toBe(true);
    // Permission accordée ensuite : les événements quittent l'agenda principal pour l'agenda « École ».
    await db.update(schema.oauthTokens).set({ scopes: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.app.created"] }).where(eq(schema.oauthTokens.userId, userId));
    google.length = 0;
    expect(await syncSchoolCalendar(db, userId)).toMatchObject({ state: "synced", created: 2, removed: 0 });
    expect(google.filter((r) => r.method === "DELETE" && r.url.includes("/calendars/primary/events/"))).toHaveLength(2);
    const titles = google.filter((r) => r.method === "POST" && r.url.includes("/events")).map((r) => r.body?.summary);
    expect(titles.sort()).toEqual(["Évaluation · SES — Contrôle marché", "⚠︎ Étude (SES)"]);
    expect(google.filter((r) => r.method === "POST" && r.url.includes("/events")).every((r) => r.url.includes("ecole%40group"))).toBe(true);
    // Deuxième passage : rien n'a changé, aucune écriture.
    google.length = 0;
    expect(await syncSchoolCalendar(db, userId)).toMatchObject({ state: "synced", created: 0, updated: 0, removed: 0 });
    expect(google.filter((r) => r.method !== "GET")).toHaveLength(0);
    // L'évaluation est supprimée : l'événement disparaît de Google.
    await db.delete(schema.schoolHomework).where(eq(schema.schoolHomework.userId, userId));
    expect(await syncSchoolCalendar(db, userId)).toMatchObject({ state: "synced", removed: 1 });
  });
});
