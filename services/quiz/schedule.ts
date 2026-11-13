import "server-only";
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { log } from "@/lib/log";
import { aiSettings } from "../ai/context";
import { isServiceConnected } from "../google/oauth";
import { notify } from "../notifications";
import { createQuiz, dueCards, evalStages, failStuck, getSettings, isStarted, retryable, runGeneration, todayDocs, userTz, type Quiz } from "./quiz";
import { STAGES, daysBetween, dueStage, isWeekend, localNow, shiftDate, slotHour, slotReached, stageDays } from "./time";

/**
 * Programmation des quiz : à l'heure du créneau, l'élève choisit le document de son quiz du jour (plus de quiz
 * automatique sur tous les cours) ; les révisions 7 jours, 3 jours puis la veille de chaque évaluation restent préparées.
 */

const q = schema.quizzes;

/** Annonce les quiz prêts : une seule notification pour tous les quiz du soir d'une même journée. */
async function announce(db: DB, userId: string, quizzes: Quiz[], today: string) {
  const ready = quizzes.filter((x) => x.status === "ready");
  const days = new Map<string, Quiz[]>();
  for (const quiz of ready) {
    if (quiz.kind === "daily") {
      days.set(quiz.forDate, [...(days.get(quiz.forDate) ?? []), quiz]);
      continue;
    }
    const stage = STAGES.find((s) => s.stage === quiz.stage)?.label;
    const title = quiz.kind === "weekly" ? "Ton quiz du week-end est prêt" : `Quiz de révision${stage ? ` ${stage}` : ""} · ${quiz.subject ?? "évaluation"}`;
    await notify(db, userId, { type: "quiz", title, body: `${quiz.questions.length} questions · ${quiz.title}`, href: `/quiz/${quiz.id}`, entityType: "quiz", entityId: quiz.id, importance: "high", dedupeKey: `quiz:${quiz.id}` });
  }
  for (const [date, list] of days) {
    const one = list.length === 1 ? list[0] : null;
    const title = date === today ? (one ? `Ton quiz du soir est prêt : ${one.subject ?? "cours du jour"}` : `Tes ${list.length} quiz du soir sont prêts`) : "Quiz de rattrapage : tes cours d'hier";
    await notify(db, userId, {
      type: "quiz",
      title,
      body: list.map((x) => `${x.subject ?? "Cours"} (${x.questions.length} questions)`).join(" · "),
      href: one ? `/quiz/${one.id}` : "/quiz",
      entityType: "quiz",
      entityId: list[0].id,
      importance: "high",
      dedupeKey: `quiz:${list.map((x) => x.id).sort().join(",")}`,
    });
  }
  return ready.length;
}

/**
 * Prépare les quiz dus pour un utilisateur. `force` : sans attendre l'heure du créneau
 * (bouton « Préparer mon quiz maintenant »). `defer` : la rédaction (longue) est laissée à l'appelant,
 * qui la lance en arrière-plan avec `finishPending`.
 */
export async function checkUser(db: DB, userId: string, o: { force?: boolean; defer?: boolean } = {}) {
  const [settings, tz, ai, drive] = await Promise.all([getSettings(db, userId), userTz(db, userId), aiSettings(db, userId), isServiceConnected(db, userId, "drive")]);
  const pending: string[] = [];
  if (!drive || !ai.configured || (!settings.enabled && !o.force)) return { created: 0, pending };
  const real = localNow(tz);
  const now = o.force ? { ...real, hour: 23 } : real;
  const done: Quiz[] = [];
  const launch = async (quizId: string) => {
    if (o.defer) pending.push(quizId);
    else {
      const quiz = await runGeneration(db, userId, quizId);
      if (quiz) done.push(quiz);
    }
  };

  await failStuck(db, userId);
  for (const quiz of await retryable(db, userId, shiftDate(now.date, -1))) await launch(quiz.id);

  // Quiz du jour : plus de quiz automatique sur tous les cours. À l'heure du créneau, on demande à l'élève
  // sur quel document (et quelle partie) il veut être interrogé, avec la liste de ce qu'il a enregistré.
  const weekend = isWeekend(now.weekday);
  if (slotReached(now.date, now, settings)) {
    const { docs } = await todayDocs(db, userId, weekend ? "week" : "today");
    const fresh = docs.filter((d) => !d.quizzes);
    if (fresh.length)
      await notify(db, userId, {
        type: "quiz",
        title: weekend ? "Sur quoi veux-tu réviser ce week-end ?" : "Sur quoi veux-tu ton quiz du jour ?",
        body: fresh.slice(0, 4).map((d) => d.name).join(" · ") + (fresh.length > 4 ? ` · +${fresh.length - 4}` : ""),
        href: "/quiz",
        importance: "high",
        dedupeKey: `quiz-choose:${now.date}`,
      });
  }

  // Évaluations : l'étape de révision la plus proche déjà atteinte (J-7, J-3, veille).
  const h = schema.schoolHomework;
  const evals = await db.select().from(h).where(and(eq(h.userId, userId), eq(h.isTest, true), gt(h.dueDate, now.date), lte(h.dueDate, shiftDate(now.date, 8))));
  for (const hw of evals) {
    const st = dueStage(hw.dueDate, now, settings);
    if (!st) continue;
    const days = daysBetween(now.date, hw.dueDate);
    if (!hw.quizSources.length) {
      await notify(db, userId, { type: "quiz", title: `Évaluation de ${hw.subject} ${days === 1 ? "demain" : `dans ${days} jours`}`, body: "Choisis les documents à réviser pour recevoir tes quiz de préparation.", href: `/quiz?eval=${hw.id}`, entityType: "homework", entityId: hw.id, dedupeKey: `quiz-docs:${hw.id}:${st.stage}` });
      continue;
    }
    // Étape déjà préparée, ou dépassée par une étape plus proche de l'évaluation : rien à faire.
    if ((await evalStages(db, userId, hw.id)).some((s) => stageDays(s) <= st.days)) continue;
    const key = `eval:${hw.id}:${st.stage}`;
    const quiz = await createQuiz(db, userId, { kind: "eval", title: `${hw.subject} · ${hw.title || "Évaluation"}`, subject: hw.subject, forDate: now.date, homeworkId: hw.id, stage: st.stage, sources: hw.quizSources, dedupeKey: key });
    if (quiz) await launch(quiz.id);
  }

  const created = await announce(db, userId, done, real.date);

  // Rappels : quiz du jour pas encore commencés, ou erreurs à revoir quand il n'y a pas eu de cours.
  const todays = (await db.select().from(q).where(and(eq(q.userId, userId), inArray(q.kind, ["daily", "weekly"]), eq(q.forDate, real.date)))).filter((x) => x.status === "ready");
  if (todays.length && real.hour >= Math.min(21, slotHour(real.weekday, settings) + 2)) {
    const waiting: Quiz[] = [];
    for (const x of todays) if (!(await isStarted(db, userId, x.id))) waiting.push(x);
    if (waiting.length === todays.length)
      await notify(db, userId, {
        type: "quiz",
        title: waiting.length > 1 ? "Tes quiz du jour t'attendent" : "Ton quiz du jour t'attend",
        body: waiting.map((x) => `${x.subject ?? x.title} (${x.questions.length} questions)`).join(" · "),
        href: waiting.length > 1 ? "/quiz" : `/quiz/${waiting[0].id}`,
        dedupeKey: `quiz-remind:${real.date}`,
      });
  }
  if (slotReached(real.date, real, settings) && !todays.length) {
    const due = await dueCards(db, userId, real.date, 50);
    if (due.length >= 3) await notify(db, userId, { type: "quiz", title: `${due.length} questions à revoir aujourd'hui`, body: "Pas de nouveau cours repéré : profites-en pour revoir tes erreurs.", href: "/quiz", dedupeKey: `quiz-cards:${real.date}` });
  }
  return { created, pending };
}

/** Rédige en arrière-plan les quiz préparés par `checkUser` avec `defer`. */
export async function finishPending(db: DB, userId: string, ids: string[]) {
  const today = localNow(await userTz(db, userId)).date;
  const done: Quiz[] = [];
  for (const id of ids) {
    const quiz = await runGeneration(db, userId, id);
    if (quiz) done.push(quiz);
  }
  await announce(db, userId, done, today);
}

/** Tâche périodique : tous les comptes dont Google Drive est connecté. */
export async function runQuizSchedule(db: DB) {
  const i = schema.integrations;
  const rows = await db.select({ userId: i.userId }).from(i).where(and(eq(i.provider, "google"), eq(i.service, "drive"), eq(i.status, "connected")));
  for (const r of rows) await checkUser(db, r.userId).catch((e) => log.warn("quiz.schedule_failed", { error: String(e) }));
}
