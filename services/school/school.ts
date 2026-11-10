import "server-only";
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { AppError, notFound } from "@/lib/errors";
import { log } from "@/lib/log";
import { serverless } from "@/lib/env";
import { addDays, isoDate } from "@/lib/utils";
import { zDate } from "@/lib/api";
import { notify } from "../notifications";
import { logActivity } from "../activity";
import * as ed from "./ecoledirecte";

type Account = typeof schema.schoolAccounts.$inferSelect;

/* ------------------------------------------------------------------ compte */

export async function getAccount(db: DB, userId: string) {
  const [a] = await db.select().from(schema.schoolAccounts).where(eq(schema.schoolAccounts.userId, userId));
  return a ?? null;
}

export function publicAccount(a: Account | null) {
  if (!a) return { status: "disconnected" as const };
  return {
    status: a.status,
    username: a.username,
    studentName: a.studentName,
    className: a.className,
    schoolName: a.schoolName,
    schoolYear: a.schoolYear,
    lastSyncAt: a.lastSyncAt,
    lastError: a.lastError,
    qcm: a.status === "qcm_required" && a.pendingQcm ? { question: a.pendingQcm.question, propositions: a.pendingQcm.propositions.map((p, i) => ({ index: i, label: Buffer.from(p, "base64").toString("utf8") })) } : null,
  };
}

async function applyLogin(db: DB, userId: string, r: ed.LoginResult, base: { username: string; passwordEnc: string; faEnc?: string | null }) {
  if (r.kind === "qcm") {
    // La session complète (jeton, cookies, 2FA-Token) est conservée chiffrée pour poursuivre après la réponse.
    const values = { ...base, status: "qcm_required", lastError: null, pendingQcm: { question: r.question, propositions: r.propositions.map((p) => p.raw), tokenEnc: encrypt(JSON.stringify(r.session)), gtk: "" } };
    await db.insert(schema.schoolAccounts).values({ userId, ...values }).onConflictDoUpdate({ target: schema.schoolAccounts.userId, set: values });
    return;
  }
  const s = ed.resolveStudent(r.account);
  const values = {
    ...base,
    tokenEnc: encrypt(JSON.stringify(r.session)),
    accountId: r.account.id,
    accountType: r.account.typeCompte,
    studentId: s.studentId,
    studentName: s.studentName,
    className: s.className,
    schoolName: s.schoolName,
    schoolYear: r.account.anneeScolaireCourante ?? null,
    status: "connected",
    pendingQcm: null,
    lastError: null,
  };
  await db.insert(schema.schoolAccounts).values({ userId, ...values }).onConflictDoUpdate({ target: schema.schoolAccounts.userId, set: values });
}

/** Connexion avec les identifiants École Directe saisis par l'utilisateur (stockés chiffrés pour les reconnexions). */
export async function connect(db: DB, userId: string, username: string, password: string) {
  const r = await ed.login(username, password);
  await applyLogin(db, userId, r, { username, passwordEnc: encrypt(password), faEnc: null });
  await logActivity(db, userId, { type: "school.connected", title: "École Directe connecté" });
  return publicAccount(await getAccount(db, userId));
}

/** Réponses de sécurité mémorisées (format historique : un seul objet). */
function factors(a: Account): ed.Factor[] {
  if (!a.faEnc) return [];
  const v = JSON.parse(decrypt(a.faEnc)) as ed.Factor | ed.Factor[];
  return Array.isArray(v) ? v : [v];
}

/** Réponse à la question de sécurité (double authentification). */
export async function answer(db: DB, userId: string, index: number) {
  const a = await getAccount(db, userId);
  if (!a?.pendingQcm) throw new AppError("bad_request", "Aucune question de sécurité en attente.");
  const raw = a.pendingQcm.propositions[index];
  if (!raw) throw new AppError("bad_request", "Choix invalide.");
  const session = JSON.parse(decrypt(a.pendingQcm.tokenEnc)) as ed.Session;
  const { factor, session: next } = await ed.answerQcm(session, raw);
  const fa = [...factors(a).filter((f) => f.cn !== factor.cn), factor].slice(-10);
  const r = await ed.login(a.username, decrypt(a.passwordEnc), fa, { answered: factor, prev: next });
  await applyLogin(db, userId, r, { username: a.username, passwordEnc: a.passwordEnc, faEnc: encrypt(JSON.stringify(fa)) });
  return publicAccount(await getAccount(db, userId));
}

export async function disconnect(db: DB, userId: string) {
  await db.delete(schema.schoolAccounts).where(eq(schema.schoolAccounts.userId, userId));
  await db.delete(schema.schoolMessages).where(eq(schema.schoolMessages.userId, userId));
  for (const t of [schema.schoolLessons, schema.schoolHomework, schema.schoolGrades]) await db.delete(t).where(and(eq(t.userId, userId), eq(t.source, "ecoledirecte")));
}

/** Appel authentifié : met à jour le jeton tournant, se reconnecte automatiquement s'il a expiré. */
async function call<T>(db: DB, userId: string, a: Account, path: string, o: { verbe?: string; query?: Record<string, string>; data?: unknown }, retried = false): Promise<T> {
  if (a.status !== "connected" || !a.tokenEnc) throw new AppError("not_configured", a.status === "qcm_required" ? "École Directe demande de répondre à la question de sécurité." : "École Directe n'est pas connecté.");
  const session = JSON.parse(decrypt(a.tokenEnc)) as ed.Session;
  const r = await ed.edRequest<T>(path, { ...o, session });
  if ((r.code === 520 || r.code === 525) && !retried) {
    const lr = await ed.login(a.username, decrypt(a.passwordEnc), factors(a));
    await applyLogin(db, userId, lr, { username: a.username, passwordEnc: a.passwordEnc, faEnc: a.faEnc });
    const fresh = (await getAccount(db, userId))!;
    return call(db, userId, fresh, path, o, true);
  }
  if (r.code !== 200) throw new ed.EdError(r.code, r.message || `Erreur École Directe (${r.code}).`);
  if (r.session.token !== session.token || r.session.cookie !== session.cookie || r.session.twoFa !== session.twoFa) {
    a.tokenEnc = encrypt(JSON.stringify(r.session));
    await db.update(schema.schoolAccounts).set({ tokenEnc: a.tokenEnc }).where(eq(schema.schoolAccounts.userId, userId));
  }
  return r.data;
}

const edDate = (s: string) => new Date(s.replace(" ", "T") + (s.length <= 16 ? ":00" : ""));
const mailboxPath = (a: Account) => (a.accountType === "E" ? `/v3/eleves/${a.studentId}` : `/v3/familles/${a.accountId}`);

/* ------------------------------------------------------------------ synchronisation */

export async function syncSchool(db: DB, userId: string) {
  let a = await getAccount(db, userId);
  if (!a) throw new AppError("not_configured", "École Directe n'est pas connecté.");
  // Sur le Mac : compte en erreur → reconnexion automatique avec le mot de passe enregistré.
  if (!serverless && a.status === "error" && a.passwordEnc) {
    const lr = await ed.login(a.username, decrypt(a.passwordEnc), factors(a));
    await applyLogin(db, userId, lr, { username: a.username, passwordEnc: a.passwordEnc, faEnc: a.faEnc });
    a = (await getAccount(db, userId))!;
  }
  const report = { lessons: 0, homework: 0, grades: 0, messages: 0, newMessages: 0, newGrades: 0 };
  try {
    // Emploi du temps : semaine passée → 3 semaines à venir
    const from = addDays(new Date(), -7);
    const to = addDays(new Date(), 21);
    const lessons = await call<ed.EdLesson[]>(db, userId, a, `/v3/E/${a.studentId}/emploidutemps.awp`, { verbe: "get", data: { dateDebut: isoDate(from), dateFin: isoDate(to), avecTrous: false } });
    a = (await getAccount(db, userId))!;
    await db.delete(schema.schoolLessons).where(and(eq(schema.schoolLessons.userId, userId), eq(schema.schoolLessons.source, "ecoledirecte"), gte(schema.schoolLessons.startAt, from), lte(schema.schoolLessons.startAt, addDays(to, 1))));
    if (Array.isArray(lessons) && lessons.length)
      await db.insert(schema.schoolLessons).values(
        lessons.map((l) => ({
          userId,
          source: "ecoledirecte",
          externalId: `${l.id}-${l.start_date}`,
          subject: l.matiere || l.text || "Cours",
          subjectCode: l.codeMatiere || null,
          teacher: l.prof || null,
          room: l.salle || null,
          startAt: edDate(l.start_date),
          endAt: edDate(l.end_date),
          cancelled: Boolean(l.isAnnule),
          color: l.color || null,
          kind: l.typeCours || "COURS",
        })),
      ).onConflictDoNothing();
    report.lessons = Array.isArray(lessons) ? lessons.length : 0;

    // Cahier de texte : liste puis détail (contenu) jour par jour
    const days = await call<ed.EdHomeworkDay>(db, userId, a, `/v3/Eleves/${a.studentId}/cahierdetexte.awp`, { verbe: "get", data: {} });
    a = (await getAccount(db, userId))!;
    for (const [day, items] of Object.entries(days ?? {}).slice(0, 21)) {
      let details: ed.EdHomeworkDetail | null = null;
      try {
        details = await call<ed.EdHomeworkDetail>(db, userId, a, `/v3/Eleves/${a.studentId}/cahierdetexte/${day}.awp`, { verbe: "get", data: {} });
        a = (await getAccount(db, userId))!;
      } catch (e) {
        log.warn("ecoledirecte.homework_detail_failed", { day, error: String(e) });
      }
      for (const h of items) {
        const d = details?.matieres.find((m) => m.id === h.idDevoir || m.aFaire?.idDevoir === h.idDevoir);
        const html = d?.aFaire?.contenu ? ed.decodeContent(d.aFaire.contenu) : null;
        const v = {
          userId,
          source: "ecoledirecte",
          externalId: String(h.idDevoir),
          subject: h.matiere,
          subjectCode: h.codeMatiere,
          title: html ? html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : h.interrogation ? "Évaluation" : "Travail à faire",
          contentHtml: html,
          dueDate: day,
          givenDate: h.donneLe || null,
          isTest: Boolean(h.interrogation),
          done: Boolean(h.effectue),
          teacher: d?.nomProf ?? null,
        };
        await db.insert(schema.schoolHomework).values(v).onConflictDoUpdate({ target: [schema.schoolHomework.userId, schema.schoolHomework.source, schema.schoolHomework.externalId], set: v });
        report.homework++;
      }
    }

    // Notes
    const notes = await call<{ notes: ed.EdGrade[] }>(db, userId, a, `/v3/eleves/${a.studentId}/notes.awp`, { verbe: "get", data: { anneeScolaire: "" } });
    a = (await getAccount(db, userId))!;
    const known = new Set((await db.select({ e: schema.schoolGrades.externalId }).from(schema.schoolGrades).where(and(eq(schema.schoolGrades.userId, userId), eq(schema.schoolGrades.source, "ecoledirecte")))).map((r) => r.e));
    for (const n of notes?.notes ?? []) {
      const v = { userId, source: "ecoledirecte", externalId: String(n.id), subject: n.libelleMatiere, title: n.devoir, kind: n.typeDevoir || null, value: n.valeur || null, outOf: n.noteSur || "20", coef: n.coef || "1", date: n.date, period: n.codePeriode || null, classAverage: n.moyenneClasse || null, nonSignificant: Boolean(n.nonSignificatif), comment: n.commentaire || null };
      await db.insert(schema.schoolGrades).values(v).onConflictDoUpdate({ target: [schema.schoolGrades.userId, schema.schoolGrades.source, schema.schoolGrades.externalId], set: v });
      report.grades++;
      if (known.size && !known.has(String(n.id))) {
        report.newGrades++;
        await notify(db, userId, { type: "system", title: `Nouvelle note : ${n.libelleMatiere}`, body: `${n.devoir} — ${n.valeur}/${n.noteSur}`, href: "/school?tab=evals", dedupeKey: `ed-grade:${n.id}` });
      }
    }

    // Messagerie (boîte de réception)
    const box = await call<{ messages: { received?: ed.EdMessage[] } }>(db, userId, a, `${mailboxPath(a)}/messages.awp`, {
      verbe: "get",
      query: { force: "false", typeRecup: "received", idClasseur: "0", orderBy: "date", order: "desc", query: "", onlyRead: "", page: "0", itemsPerPage: "50", getAll: "0" },
      data: { anneeMessages: a.schoolYear ?? "" },
    });
    const existing = new Set((await db.select({ e: schema.schoolMessages.externalId }).from(schema.schoolMessages).where(eq(schema.schoolMessages.userId, userId))).map((r) => r.e));
    for (const m of box?.messages?.received ?? []) {
      const fromName = m.from?.name || [m.from?.civilite, m.from?.prenom, m.from?.nom].filter(Boolean).join(" ") || "École";
      await db
        .insert(schema.schoolMessages)
        .values({ userId, externalId: m.id, folder: "received", subject: m.subject || "(sans objet)", fromName, date: edDate(m.date), read: Boolean(m.read) })
        .onConflictDoUpdate({ target: [schema.schoolMessages.userId, schema.schoolMessages.folder, schema.schoolMessages.externalId], set: { read: Boolean(m.read), subject: m.subject || "(sans objet)" } });
      report.messages++;
      if (existing.size && !existing.has(m.id) && !m.read) {
        report.newMessages++;
        await notify(db, userId, { type: "email", title: `École Directe : ${m.subject || "Nouveau message"}`, body: fromName, href: "/inbox?box=school", dedupeKey: `ed-msg:${m.id}` });
      }
    }
    await db.update(schema.schoolAccounts).set({ lastSyncAt: new Date(), lastError: null }).where(eq(schema.schoolAccounts.userId, userId));
    return report;
  } catch (e) {
    await db.update(schema.schoolAccounts).set({ lastError: (e as Error).message.slice(0, 300), status: e instanceof ed.EdError && e.edCode === 505 ? "error" : undefined }).where(eq(schema.schoolAccounts.userId, userId));
    throw e;
  }
}

export async function messageContent(db: DB, userId: string, id: string) {
  const [m] = await db.select().from(schema.schoolMessages).where(and(eq(schema.schoolMessages.id, id), eq(schema.schoolMessages.userId, userId)));
  if (!m) throw notFound("Message");
  if (m.contentHtml !== null) return m;
  const a = await getAccount(db, userId);
  if (!a) throw new AppError("not_configured", "École Directe n'est pas connecté.");
  const d = await call<{ content: string; files?: { id: number; libelle: string }[] }>(db, userId, a, `${mailboxPath(a)}/messages/${m.externalId}.awp`, { verbe: "get", query: { mode: "destinataire" }, data: { anneeMessages: a.schoolYear ?? "" } });
  const [u] = await db
    .update(schema.schoolMessages)
    .set({ contentHtml: ed.decodeContent(d.content), read: true, files: (d.files ?? []).map((f) => ({ id: f.id, name: f.libelle })) })
    .where(eq(schema.schoolMessages.id, id))
    .returning();
  return u;
}

/* ------------------------------------------------------------------ consultation & saisie manuelle */

export async function listLessons(db: DB, userId: string, from: Date, to: Date) {
  return db.select().from(schema.schoolLessons).where(and(eq(schema.schoolLessons.userId, userId), gte(schema.schoolLessons.startAt, from), lt(schema.schoolLessons.startAt, to))).orderBy(asc(schema.schoolLessons.startAt));
}

export const LessonInput = z
  .object({ subject: z.string().trim().min(1).max(120), teacher: z.string().max(120).nullable().optional(), room: z.string().max(60).nullable().optional(), startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }), color: z.string().max(20).nullable().optional() })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), { message: "La fin doit être après le début", path: ["endAt"] });

export async function addLesson(db: DB, userId: string, raw: z.input<typeof LessonInput>) {
  const v = LessonInput.parse(raw);
  const [l] = await db.insert(schema.schoolLessons).values({ ...v, userId, source: "manual", startAt: new Date(v.startAt), endAt: new Date(v.endAt) }).returning();
  return l;
}

export const HomeworkInput = z.object({
  subject: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  details: z.string().max(10_000).optional(),
  dueDate: zDate,
  isTest: z.boolean().default(false),
  /** Documents Drive à réviser (évaluations) : servent aux quiz de préparation. */
  quizSources: z.array(z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(300), mimeType: z.string().max(200).optional() })).max(15).optional(),
});

export async function listHomework(db: DB, userId: string, o: { from?: string; to?: string; kind?: "all" | "homework" | "test"; done?: boolean }) {
  const h = schema.schoolHomework;
  const where = [eq(h.userId, userId)];
  if (o.from) where.push(gte(h.dueDate, o.from));
  if (o.to) where.push(lte(h.dueDate, o.to));
  if (o.kind === "homework") where.push(eq(h.isTest, false));
  if (o.kind === "test") where.push(eq(h.isTest, true));
  if (o.done !== undefined) where.push(eq(h.done, o.done));
  return db.select().from(h).where(and(...where)).orderBy(asc(h.dueDate), asc(h.subject)).limit(500);
}

export async function addHomework(db: DB, userId: string, raw: z.input<typeof HomeworkInput>) {
  const v = HomeworkInput.parse(raw);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const [r] = await db
    .insert(schema.schoolHomework)
    .values({ userId, source: "manual", subject: v.subject, title: v.title, contentHtml: v.details ? `<p>${esc(v.details).replace(/\n/g, "<br>")}</p>` : null, dueDate: v.dueDate, givenDate: isoDate(), isTest: v.isTest, quizSources: v.isTest ? (v.quizSources ?? []) : [] })
    .returning();
  return r;
}

/** Fait / à faire — répercuté sur École Directe pour ses propres devoirs. */
export async function setHomeworkDone(db: DB, userId: string, id: string, done: boolean) {
  const [h] = await db.select().from(schema.schoolHomework).where(and(eq(schema.schoolHomework.id, id), eq(schema.schoolHomework.userId, userId)));
  if (!h) throw notFound("Devoir");
  let synced = h.source !== "ecoledirecte";
  if (h.source === "ecoledirecte" && h.externalId) {
    const a = await getAccount(db, userId);
    if (a?.status === "connected") {
      try {
        await call(db, userId, a, `/v3/Eleves/${a.studentId}/cahierdetexte.awp`, { verbe: "put", data: { idDevoirsEffectues: done ? [Number(h.externalId)] : [], idDevoirsNonEffectues: done ? [] : [Number(h.externalId)] } });
        synced = true;
      } catch (e) {
        log.warn("ecoledirecte.set_done_failed", { error: String(e) });
      }
    }
  }
  const [u] = await db.update(schema.schoolHomework).set({ done }).where(eq(schema.schoolHomework.id, id)).returning();
  return { ...u, synced };
}

export async function deleteManual(db: DB, userId: string, kind: "lesson" | "homework" | "grade", id: string) {
  const t = kind === "lesson" ? schema.schoolLessons : kind === "homework" ? schema.schoolHomework : schema.schoolGrades;
  const r = await db.delete(t).where(and(eq(t.id, id), eq(t.userId, userId), eq(t.source, "manual"))).returning({ id: t.id });
  if (!r.length) throw new AppError("bad_request", "Seuls les éléments ajoutés manuellement peuvent être supprimés.");
}

export const GradeInput = z.object({
  subject: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  value: z.string().trim().max(10).regex(/^(\d{1,3}([.,]\d{1,2})?|Abs|Disp|NE)$/i, "Note invalide"),
  outOf: z.string().trim().regex(/^\d{1,3}([.,]\d{1,2})?$/).default("20"),
  coef: z.string().trim().regex(/^\d{1,2}([.,]\d{1,2})?$/).default("1"),
  date: zDate,
});

export async function listGrades(db: DB, userId: string) {
  return db.select().from(schema.schoolGrades).where(eq(schema.schoolGrades.userId, userId)).orderBy(desc(schema.schoolGrades.date)).limit(500);
}

export async function addGrade(db: DB, userId: string, raw: z.input<typeof GradeInput>) {
  const v = GradeInput.parse(raw);
  const [g] = await db.insert(schema.schoolGrades).values({ ...v, userId, source: "manual" }).returning();
  return g;
}

/** Moyennes par matière (notes sur 20, coefficients, hors non significatives). */
export function averages(grades: { subject: string; value: string | null; outOf: string; coef: string; nonSignificant: boolean }[]) {
  const num = (s: string | null) => (s && /^\d/.test(s) ? Number(s.replace(",", ".")) : NaN);
  const by = new Map<string, { sum: number; w: number; n: number }>();
  for (const g of grades) {
    const v = num(g.value);
    const on = num(g.outOf);
    const c = num(g.coef) || 1;
    if (g.nonSignificant || Number.isNaN(v) || !on) continue;
    const cur = by.get(g.subject) ?? { sum: 0, w: 0, n: 0 };
    cur.sum += (v / on) * 20 * c;
    cur.w += c;
    cur.n++;
    by.set(g.subject, cur);
  }
  const subjects = [...by.entries()].map(([subject, x]) => ({ subject, average: Math.round((x.sum / x.w) * 100) / 100, count: x.n })).sort((a, b) => a.subject.localeCompare(b.subject));
  const general = subjects.length ? Math.round((subjects.reduce((s, x) => s + x.average, 0) / subjects.length) * 100) / 100 : null;
  return { subjects, general };
}

export async function schoolSummary(db: DB, userId: string) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const [account, lessons, homework, tests, unread, grades] = await Promise.all([
    getAccount(db, userId),
    listLessons(db, userId, start, addDays(start, 1)),
    listHomework(db, userId, { from: isoDate(), to: isoDate(addDays(now, 7)), kind: "homework", done: false }),
    listHomework(db, userId, { from: isoDate(), to: isoDate(addDays(now, 21)), kind: "test" }),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.schoolMessages).where(and(eq(schema.schoolMessages.userId, userId), eq(schema.schoolMessages.read, false))),
    listGrades(db, userId),
  ]);
  return { account: publicAccount(account), lessons, homework, tests, unreadMessages: unread[0]?.n ?? 0, average: averages(grades).general, lastGrade: grades[0] ?? null };
}


