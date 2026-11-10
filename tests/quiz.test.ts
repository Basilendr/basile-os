import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DB } from "@/lib/db";

process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.DATA_DIR = "/tmp/claude-501/bos-test-data";

let db: DB;
let userId: string;

const COURSE = `La Révolution française\n\nEn 1789, les États généraux se réunissent à Versailles. Le 14 juillet 1789, la Bastille est prise par les Parisiens.\nLa Déclaration des droits de l'homme et du citoyen est adoptée le 26 août 1789.\nLouis XVI est guillotiné le 21 janvier 1793, pendant la Terreur.`;
const GDOC = "application/vnd.google-apps.document";
const DOC = { id: "doc1", name: "Cours Révolution", mimeType: GDOC, modifiedTime: "2026-11-10T15:00:00.000Z", size: "5000", parents: ["fold1"] };
const DOCS = [DOC, { ...DOC, id: "doc2", name: "Vocabulary unit 3", parents: ["fold2"] }, { ...DOC, id: "doc3", name: "Notes du jour", parents: ["root0"] }];
const FOLDERS = [
  { id: "etu", name: "Etudes", parents: ["root0"] },
  { id: "fold1", name: "Histoire-Géo", parents: ["etu"] },
  { id: "fold2", name: "Anglais", parents: ["etu"] },
  { id: "fold3", name: "SES", parents: ["etu"] },
];
const QUIZ = {
  title: "La Révolution française",
  subject: "Histoire-Géo",
  notions: ["1789 : États généraux", "14 juillet 1789 : prise de la Bastille", "21 janvier 1793 : exécution de Louis XVI"],
  questions: [
    { type: "mcq", prompt: "En quelle année commence la Révolution française ?", choices: ["1789", "1815", "1848", "1914"], answerIndex: 0, explanation: "Les États généraux se réunissent en 1789.", subject: "Histoire-Géo", topic: "Révolution française", source: "Cours Révolution", difficulty: 1 },
    { type: "tf", prompt: "La Bastille est prise le 14 juillet 1789.", answerBool: true, explanation: "C'est la date retenue pour la fête nationale.", subject: "Histoire-Géo", topic: "Prise de la Bastille", difficulty: 1 },
    { type: "open", prompt: "Quel roi est guillotiné en 1793 ?", answer: "Louis XVI", accepted: ["Louis 16"], explanation: "Il est exécuté le 21 janvier 1793.", subject: "Histoire-Géo", topic: "La Terreur", difficulty: 2 },
  ],
  keyPoints: ["1789 : début de la Révolution française."],
};

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

/** Simule Google Drive et l'IA. `files` : cours « modifiés » renvoyés par Drive ; `judge` : verdict de l'IA sur une réponse ouverte. */
function world(o: { files?: unknown[]; judge?: boolean } = {}) {
  const calls = { ai: 0, drive: 0 };
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("generativelanguage")) {
      calls.ai++;
      const prompt = String(init?.body);
      const content = prompt.includes("Tu corriges")
        ? JSON.stringify({ correct: o.judge ?? true, feedback: "Verdict du correcteur." })
        : prompt.includes("professeur particulier patient")
          ? "Voici une explication plus simple."
          : prompt.includes("Tu ranges")
            ? JSON.stringify({ items: [{ index: 0, subject: "ses" }] })
            : JSON.stringify(QUIZ);
      return json({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    }
    if (url.includes("userinfo")) return json({ email: "eleve@example.com" });
    if (url.includes("/drive/v3/")) {
      calls.drive++;
      if (url.includes("/export")) return new Response(COURSE);
      if (url.includes("/files?")) {
        const q = new URL(url).searchParams.get("q") ?? "";
        return q.includes("mimeType = '") ? json({ files: FOLDERS }) : json({ files: o.files ?? DOCS });
      }
      const id = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
      return json(DOCS.find((d) => d.id === id) ?? DOC);
    }
    return json({ access_token: "at1", refresh_token: "rt1", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/drive.readonly" });
  });
  return calls;
}

beforeAll(async () => {
  const { setup } = await import("./helpers");
  ({ db, userId } = await setup());
  const { schema } = await import("@/lib/db");
  const { setCachedSecret } = await import("@/lib/secrets");
  setCachedSecret("GEMINI_API_KEY", "AIza-test");
  const prefs = { aiProvider: "gemini", aiModel: "gemini-flash-latest" };
  await db.insert(schema.userPreferences).values({ userId, ...prefs }).onConflictDoUpdate({ target: schema.userPreferences.userId, set: prefs });
});
afterEach(() => vi.unstubAllGlobals());

describe("créneaux des quiz", () => {
  it("18 h en semaine, 14 h le mercredi, le matin le week-end, dans le fuseau de l'élève", async () => {
    const { localNow, mondayOf, slotHour, slotReached, weekdayOf, zonedMidnight } = await import("@/services/quiz/time");
    const h = { weekdayHour: 18, wednesdayHour: 14, weekendHour: 10 };
    expect(weekdayOf("2026-11-10")).toBe(2); // mardi
    expect([slotHour(2, h), slotHour(3, h), slotHour(6, h), slotHour(0, h)]).toEqual([18, 14, 10, 10]);
    expect(slotReached("2026-11-10", { date: "2026-11-10", hour: 17, minute: 59, weekday: 2 }, h)).toBe(false);
    expect(slotReached("2026-11-10", { date: "2026-11-10", hour: 18, minute: 0, weekday: 2 }, h)).toBe(true);
    expect(slotReached("2026-11-11", { date: "2026-11-11", hour: 13, minute: 30, weekday: 3 }, h)).toBe(false);
    expect(slotReached("2026-11-11", { date: "2026-11-11", hour: 14, minute: 0, weekday: 3 }, h)).toBe(true);
    expect(slotReached("2026-11-10", { date: "2026-11-11", hour: 7, minute: 0, weekday: 3 }, h)).toBe(true); // rattrapage du lendemain
    expect(localNow("Europe/Paris", new Date("2026-11-10T17:30:00Z"))).toEqual({ date: "2026-11-10", hour: 18, minute: 30, weekday: 2 });
    expect(localNow("Europe/Paris", new Date("2026-11-10T23:30:00Z")).date).toBe("2026-11-11");
    expect(zonedMidnight("2026-11-10", "Europe/Paris").toISOString()).toBe("2026-11-09T23:00:00.000Z");
    expect(zonedMidnight("2026-07-01", "Europe/Paris").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
  });

  it("évaluation : J-7, J-3 puis la veille, chacun à l'heure du créneau", async () => {
    const { dueStage } = await import("@/services/quiz/time");
    const h = { weekdayHour: 18, wednesdayHour: 14, weekendHour: 10 };
    const at = (date: string, hour: number, weekday: number) => dueStage("2026-11-17", { date, hour, minute: 0, weekday }, h)?.stage ?? null;
    expect(at("2026-11-09", 20, 1)).toBeNull(); // J-8
    expect(at("2026-11-10", 17, 2)).toBeNull(); // J-7 avant 18 h
    expect(at("2026-11-10", 18, 2)).toBe("j7");
    expect(at("2026-11-14", 9, 6)).toBe("j7"); // samedi avant 10 h : pas encore J-3
    expect(at("2026-11-14", 10, 6)).toBe("j3");
    expect(at("2026-11-16", 17, 1)).toBe("j3");
    expect(at("2026-11-16", 18, 1)).toBe("j1");
    expect(at("2026-11-17", 8, 2)).toBeNull(); // le jour même
  });
});

describe("questions et correction", () => {
  it("écarte les questions inutilisables et garde la bonne réponse après mélange", async () => {
    const { sanitizeQuestions } = await import("@/services/quiz/core");
    const out = sanitizeQuestions(
      [
        ...QUIZ.questions,
        { type: "mcq", prompt: "Question sans bonne réponse valable ?", choices: ["a", "b"], answerIndex: 5, explanation: "" },
        { type: "mcq", prompt: "Propositions toutes identiques ici ?", choices: ["Paris", "paris", "Paris "], answerIndex: 0, explanation: "" },
        { type: "open", prompt: "Réponse attendue manquante ?", answer: "", explanation: "" },
        { type: "tf", prompt: "La Bastille est prise le 14 juillet 1789.", answerBool: true, explanation: "doublon" },
        { type: "essay", prompt: "Type de question inconnu ?", explanation: "" },
      ],
      10,
      () => 0.99,
    );
    expect(out.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(out[0].choices![out[0].answerIndex!]).toBe("1789");
    expect(out[0].choices).toHaveLength(4);
    expect(sanitizeQuestions(QUIZ.questions, 2)).toHaveLength(2);
  });

  it("tolère accents, articles et fautes de frappe, mais pas une date fausse", async () => {
    const { closeEnough, grade } = await import("@/services/quiz/core");
    expect(closeEnough("la révolution française", "Révolution francaise")).toBe(true);
    expect(closeEnough("Robespierrre", "Robespierre")).toBe(true);
    expect(closeEnough("1798", "1789")).toBe(false);
    expect(closeEnough("Danton", "Robespierre")).toBe(false);
    const open = { id: "q", type: "open" as const, prompt: "p", answer: "Louis XVI", accepted: ["Louis 16"], explanation: "", subject: "H", topic: "", difficulty: 1 };
    expect(grade(open, "louis 16")).toBe(true);
    expect(grade(open, "")).toBe(false);
    expect(grade(open, "le roi de France")).toBeNull(); // à faire juger par l'IA
    const mcq = { id: "q", type: "mcq" as const, prompt: "p", choices: ["a", "b"], answerIndex: 1, explanation: "", subject: "H", topic: "", difficulty: 1 };
    expect([grade(mcq, "1"), grade(mcq, "0"), grade(mcq, "")]).toEqual([true, false, false]);
  });

  it("répartit les questions entre tous les cours du jour", async () => {
    const { buildPrompt, shares } = await import("@/services/quiz/generate");
    expect(shares([1, 1, 1], 10).sort()).toEqual([3, 3, 4]);
    expect(shares([100, 10, 10], 6)).toEqual([4, 1, 1]);
    expect(shares([5, 1, 1, 1], 2)).toEqual([2, 0, 0, 0]);
    const doc = (name: string, text: string) => ({ id: name, name, path: "Etudes / HGGSP", text, fresh: null, minor: false });
    const prompt = buildPrompt({ kind: "daily", count: 10, docs: [doc("Axe 1", "a".repeat(4000)), doc("Fashion", "b".repeat(900))] });
    expect(prompt).toMatch(/"Axe 1" : 7/);
    expect(prompt).toMatch(/"Fashion" : 3/);
    expect(prompt).toContain('dossier="Etudes / HGGSP"');
  });

  it("range chaque cours dans sa matière d'après son dossier ou son nom", async () => {
    const { subjectInName, subjectOf } = await import("@/services/quiz/sources");
    const folders = new Map([...FOLDERS, { id: "sub", name: "Thème 1-démocratie", parents: ["fold1"] }, { id: "mac", name: "Mon Mac", parents: [] }].map((f) => [f.id, f]));
    expect(subjectOf(folders, ["sub"], "1 - Introduction")).toBe("Histoire-Géo");
    expect(subjectOf(folders, ["fold2"], "Vocabulary")).toBe("Anglais");
    expect(subjectOf(folders, ["root0"], "SVT-les unités biologiques")).toBe("SVT");
    expect(subjectOf(folders, ["mac"], "Notes du jour")).toBeNull();
    expect(subjectInName("Fiche SES chapitre 2", ["Histoire-Géo", "SES"])).toBe("SES");
  });

  it("allonge le quiz avec le cours : environ une question par notion", async () => {
    const { questionRange } = await import("@/services/quiz/quiz");
    const doc = (n: number) => ({ text: "x".repeat(n), fresh: null });
    const daily = { kind: "daily", stage: null, options: {} };
    expect(questionRange(daily, [doc(800)], 10)).toEqual({ min: 10, max: 10 });
    expect(questionRange(daily, [doc(3000)], 10)).toEqual({ min: 11, max: 19 });
    expect(questionRange(daily, [doc(20_000)], 10)).toEqual({ min: 25, max: 25 });
    expect(questionRange({ kind: "eval", stage: "j1", options: {} }, [doc(2000)], 10)).toEqual({ min: 20, max: 20 });
    expect(questionRange({ kind: "custom", stage: null, options: { count: 15 } }, [doc(50_000)], 10)).toEqual({ min: 15, max: 15 });
  });

  it("repère ce qui a été ajouté à un cours depuis la veille", async () => {
    const { addedSince } = await import("@/services/quiz/sources");
    expect(addedSince(null, "a")).toBeNull();
    expect(addedSince("Chapitre 1\nLa monnaie", "Chapitre 1\nLa monnaie\nLes fonctions de la monnaie")).toBe("Les fonctions de la monnaie");
  });
});

describe("passer un quiz", () => {
  it("ne dévoile la réponse qu'après coup, note le quiz et programme la révision des erreurs", { timeout: 30_000 }, async () => {
    const { schema } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const { answerQuestion, createQuiz, createReview, getQuiz, overview, userTz } = await import("@/services/quiz/quiz");
    const { localNow, shiftDate } = await import("@/services/quiz/time");
    const today = localNow(await userTz(db, userId)).date;
    const base = { explanation: "Explication.", difficulty: 1 };
    const quiz = await createQuiz(db, userId, {
      kind: "custom",
      title: "Révision",
      forDate: today,
      status: "ready",
      questions: [
        { ...base, id: "q1", type: "mcq", prompt: "Quelle est la capitale de l'Espagne ?", choices: ["Madrid", "Lisbonne", "Rome", "Paris"], answerIndex: 0, subject: "Espagnol", topic: "Capitales" },
        { ...base, id: "q2", type: "tf", prompt: "Le PIB mesure la richesse produite.", answerBool: true, subject: "SES", topic: "PIB" },
        { ...base, id: "q3", type: "open", prompt: "Qui a écrit Les Misérables ?", answer: "Victor Hugo", accepted: ["Hugo"], subject: "Français", topic: "Hugo" },
      ],
    });
    const before = await getQuiz(db, userId, quiz!.id);
    expect(JSON.stringify(before.questions)).not.toMatch(/answerIndex|answerBool|Victor Hugo/);

    const r1 = await answerQuestion(db, userId, quiz!.id, { questionId: "q1", value: "1" });
    expect(r1).toMatchObject({ correct: false, done: false, reveal: { answerIndex: 0 } });
    expect((await answerQuestion(db, userId, quiz!.id, { questionId: "q2", value: "true" })).correct).toBe(true);
    const r3 = await answerQuestion(db, userId, quiz!.id, { questionId: "q3", value: "victor hugoo" });
    expect(r3).toMatchObject({ correct: true, done: true, score: 2, total: 3 });
    // Répondre deux fois à la même question ne change rien.
    expect((await answerQuestion(db, userId, quiz!.id, { questionId: "q1", value: "0" })).correct).toBe(false);

    const [card] = await db.select().from(schema.quizCards).where(eq(schema.quizCards.userId, userId));
    expect(card).toMatchObject({ box: 1, dueDate: shiftDate(today, 1), subject: "Espagnol" });
    const o = await overview(db, userId);
    expect(o.stats).toMatchObject({ streak: 1, doneToday: true });
    expect(o.cards).toEqual({ due: 0, total: 1 });
    expect(o.quizzes.find((x) => x.id === quiz!.id)).toMatchObject({ completed: true, best: 67 });
    expect(o.stats.weak[0]).toMatchObject({ topic: "Capitales" });

    // Le lendemain, la question ratée revient ; réussie, elle est repoussée à 3 jours.
    await expect(createReview(db, userId)).rejects.toThrow(/Aucune question/);
    await db.update(schema.quizCards).set({ dueDate: today }).where(eq(schema.quizCards.id, card.id));
    const review = await createReview(db, userId);
    expect((await createReview(db, userId)).id).toBe(review.id);
    const view = await getQuiz(db, userId, review.id);
    expect(view.questions).toHaveLength(1);
    expect((await answerQuestion(db, userId, review.id, { questionId: view.questions[0].id, value: "0" })).correct).toBe(true);
    const [after] = await db.select().from(schema.quizCards).where(eq(schema.quizCards.id, card.id));
    expect(after).toMatchObject({ box: 2, dueDate: shiftDate(today, 3) });
  });

  it("fait juger les réponses écrites par l'IA, avec « Compter comme juste » et « Je n'ai pas compris »", { timeout: 30_000 }, async () => {
    const { schema } = await import("@/lib/db");
    const { and, eq } = await import("drizzle-orm");
    const { answerQuestion, createQuiz, explainQuestion, userTz } = await import("@/services/quiz/quiz");
    const { cardKey } = await import("@/services/quiz/core");
    const { localNow } = await import("@/services/quiz/time");
    const today = localNow(await userTz(db, userId)).date;
    const question = (id: string, prompt: string) => ({ id, type: "open" as const, prompt, answer: "Offre et demande", explanation: "Explication.", subject: "SES", topic: "Marché", difficulty: 2 });
    const quiz = await createQuiz(db, userId, { kind: "custom", title: "SES", forDate: today, status: "ready", questions: [question("q1", "Qu'est-ce qui fixe le prix sur un marché ?"), question("q2", "Quelles sont les deux forces d'un marché concurrentiel ?")] });
    const cardOf = async (prompt: string) => (await db.select().from(schema.quizCards).where(and(eq(schema.quizCards.userId, userId), eq(schema.quizCards.key, cardKey(prompt)))))[0];

    let calls = world({ judge: true });
    expect(await answerQuestion(db, userId, quiz!.id, { questionId: "q1", value: "la rencontre des acheteurs et des vendeurs" })).toMatchObject({ correct: true, feedback: "Verdict du correcteur." });
    expect(calls.ai).toBe(1);

    calls = world({ judge: false });
    expect((await answerQuestion(db, userId, quiz!.id, { questionId: "q2", value: "les vendeurs et les acheteurs" })).correct).toBe(false);
    expect(await cardOf("Quelles sont les deux forces d'un marché concurrentiel ?")).toBeTruthy();
    expect((await explainQuestion(db, userId, quiz!.id, "q2")).text).toBe("Voici une explication plus simple.");
    const fixed = await answerQuestion(db, userId, quiz!.id, { questionId: "q2", override: true });
    expect(fixed).toMatchObject({ correct: true, score: 2, done: true });
    expect(await cardOf("Quelles sont les deux forces d'un marché concurrentiel ?")).toBeUndefined();
  });
});

describe("quiz programmés", () => {
  it("prépare le quiz du jour depuis Drive, sans doublon, et les révisions avant une évaluation", { timeout: 60_000 }, async () => {
    const { schema } = await import("@/lib/db");
    const { and, eq } = await import("drizzle-orm");
    const { buildAuthUrl, handleCallback } = await import("@/services/google/oauth");
    const { checkUser } = await import("@/services/quiz/schedule");
    const { getQuiz, overview, scheduledQuiz, setEvalSources, userTz } = await import("@/services/quiz/quiz");
    const { addHomework } = await import("@/services/school/school");
    const { isWeekend, localNow, shiftDate } = await import("@/services/quiz/time");

    // Sans Drive connecté, rien ne se passe.
    world();
    expect(await checkUser(db, userId, { force: true })).toEqual({ created: 0, pending: [] });
    const state = new URL(await buildAuthUrl(db, userId, ["drive"])).searchParams.get("state")!;
    expect((await handleCallback(db, userId, { code: "ok", state })).connected).toEqual(["drive"]);

    const now = localNow(await userTz(db, userId));
    const weekend = isWeekend(now.weekday);
    const todays = () => db.select().from(schema.quizzes).where(and(eq(schema.quizzes.userId, userId), eq(schema.quizzes.forDate, now.date), eq(schema.quizzes.kind, weekend ? "weekly" : "daily")));

    // Aucun cours enregistré aujourd'hui : pas de quiz.
    world({ files: [] });
    expect((await checkUser(db, userId, { force: true })).created).toBe(0);
    expect(await todays()).toHaveLength(0);

    // Des cours ont été enregistrés : un quiz par matière (dossier, nom ou IA), rédigé et annoncé.
    let calls = world();
    expect((await checkUser(db, userId, { force: true })).created).toBeGreaterThanOrEqual(1);
    const list = await todays();
    if (weekend) {
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ status: "ready", title: "Bilan de la semaine" });
    } else {
      expect(list.map((x) => x.subject).sort()).toEqual(["Anglais", "Histoire-Géo", "SES"]);
      expect(list.find((x) => x.subject === "Histoire-Géo")).toMatchObject({ status: "ready", title: "La Révolution française", sources: [{ id: "doc1", name: "Cours Révolution" }], keyPoints: QUIZ.keyPoints, dedupeKey: `daily:${now.date}:histoire-geo` });
      expect(list.find((x) => x.subject === "SES")?.sources).toEqual([{ id: "doc3", name: "Notes du jour" }]);
    }
    const quiz = list[0];
    expect(quiz.questions.filter((q) => !q.review)).toHaveLength(3);
    const notes = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.type, "quiz")));
    expect(notes.some((n) => /quiz du soir|week-end|rattrapage/.test(n.title))).toBe(true);
    expect(JSON.stringify((await getQuiz(db, userId, quiz.id)).questions)).not.toContain("answerIndex");

    // Nouvelle vérification : ni nouveau quiz, ni nouvel appel à l'IA.
    calls = world();
    expect((await checkUser(db, userId, { force: true })).created).toBe(0);
    expect(calls.ai).toBe(0);

    // Évaluation dans 3 jours avec ses documents : le quiz J-3 est préparé ; sans document, un rappel est envoyé.
    const hw = await addHomework(db, userId, { subject: "Histoire-Géo", title: "Contrôle Révolution", dueDate: shiftDate(now.date, 3), isTest: true, quizSources: [{ id: "doc1", name: "Cours Révolution" }] });
    const bare = await addHomework(db, userId, { subject: "SES", title: "Contrôle marché", dueDate: shiftDate(now.date, 7), isTest: true });
    expect((await checkUser(db, userId, { force: true })).created).toBe(1);
    expect(await scheduledQuiz(db, userId, `eval:${hw.id}:j3`)).toMatchObject({ status: "ready", kind: "eval", stage: "j3", subject: "Histoire-Géo" });
    const reminders = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.entityId, bare.id)));
    expect(reminders).toHaveLength(1);
    expect(reminders[0].href).toBe(`/quiz?eval=${bare.id}`);

    const o = await overview(db, userId);
    const e = o.evals.find((x) => x.id === hw.id)!;
    expect(e.daysLeft).toBe(3);
    expect(e.stages.map((s) => [s.stage, s.state])).toEqual([["j7", "missed"], ["j3", "todo"], ["j1", "upcoming"]]);
    expect(o.today.quizzes.map((x) => x.id)).toContain(quiz.id);

    // Les documents choisis ensuite déclenchent le quiz de l'étape en cours.
    await setEvalSources(db, userId, bare.id, { sources: [{ id: "doc1", name: "Cours Révolution" }] });
    const deferred = await checkUser(db, userId, { force: true, defer: true });
    expect(deferred.pending).toHaveLength(1);
    expect(await scheduledQuiz(db, userId, `eval:${bare.id}:j7`)).toMatchObject({ status: "generating" });
  });
});
