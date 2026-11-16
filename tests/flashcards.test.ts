import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DB } from "@/lib/db";

process.env.DATA_DIR = "/tmp/claude-501/bos-test-data";

let db: DB;
let userId: string;

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
const CARDS = {
  title: "La ville",
  lang: "es",
  isLanguageCourse: true,
  cards: [
    { term: "el ayuntamiento", translation: "la mairie", example: "El ayuntamiento está en la plaza.", exampleFr: "La mairie est sur la place.", note: null, kind: "mot" },
    { term: "la canción", translation: "la chanson", example: null, exampleFr: null, note: "nom féminin", kind: "mot" },
    { term: "crecer", translation: "grandir", example: null, exampleFr: null, note: "irrégulier : crezco", kind: "verbe" },
    { term: "la canción", translation: "doublon", kind: "mot" },
  ],
};
const GUIDE = {
  summary: "Le cours présente la vie en ville en Espagne.",
  sentences: [{ text: "Vivo en una ciudad grande.", fr: "Je vis dans une grande ville." }],
  grammar: [{ title: "Le présent des verbes en -cer", explanation: "crecer → crezco à la 1re personne.", examples: [{ text: "Crezco en Madrid.", fr: "Je grandis à Madrid." }] }],
  oral: [{ question: "¿Dónde vives?", answer: "Vivo en Lille, una ciudad del norte.", fr: "J'habite à Lille, une ville du nord." }],
};

/** Simule l'IA : retranscription d'une photo (API native Gemini), lexique, fiche, correction. */
function world() {
  const calls = { scan: 0, cards: 0, guide: 0, prompts: [] as string[] };
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    calls.prompts.push(body);
    if (url.includes(":generateContent")) {
      calls.scan++;
      return json({ candidates: [{ content: { parts: [{ text: "Unidad 3 — La ciudad\nVivo en una ciudad grande. El ayuntamiento está en la plaza." }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } });
    }
    if (url.includes("generativelanguage")) {
      const content = body.includes("Tu corriges") ? JSON.stringify({ correct: false, feedback: "Ce n'est pas le bon mot." }) : body.includes("fiche qui lui permet") ? (calls.guide++, JSON.stringify(GUIDE)) : (calls.cards++, JSON.stringify(CARDS));
      return json({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    }
    return json({});
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

describe("vocabulaire : cœur", () => {
  it("reconnaît la langue, lit un lexique collé et corrige les accents", async () => {
    const { checkAnswer, langOf, parseLexicon, schedule, variants } = await import("@/services/flashcards/core");
    expect(langOf("LVA ESPAGNOL")).toBe("es");
    expect(langOf(null, "Etudes / Anglais", "Unit 3")).toBe("en");
    expect(langOf("Deutsch")).toBe("de");
    expect(langOf("Histoire-Géo")).toBeNull();

    expect(parseLexicon("la ciudad = la ville\nel barrio → le quartier\n- crecer : grandir")).toEqual([
      { term: "la ciudad", translation: "la ville" },
      { term: "el barrio", translation: "le quartier" },
      { term: "crecer", translation: "grandir" },
    ]);
    expect(parseLexicon("Vivo en una ciudad grande. Me gusta mucho mi barrio porque es tranquilo.")).toBeNull();

    expect(checkAnswer("la canción", "la canción")).toBe("exact");
    expect(checkAnswer("cancion", "la canción")).toBe("accents");
    expect(checkAnswer("ayuntamento", "el ayuntamiento")).toBe("typo");
    expect(checkAnswer("la ciudad", "el pueblo")).toBe("wrong");
    expect(checkAnswer("run", "(to) run")).toBe("exact");
    expect(checkAnswer("huir", "correr, huir")).toBe("exact");
    expect(checkAnswer("Strasse", "die Straße")).toBe("accents");
    expect(variants("Hola, ¿qué tal?")).not.toContain("Hola");

    let s = { state: "new", interval: 0, ease: 250, reps: 0, lapses: 0 };
    s = schedule(s, 3);
    expect(s.interval).toBe(1);
    s = schedule(s, 3);
    expect(s.interval).toBe(3);
    s = schedule(s, 3);
    expect(s.interval).toBe(8);
    const failed = schedule(s, 1);
    expect(failed).toMatchObject({ interval: 0, reps: 0, lapses: 1, state: "learning" });
    expect(schedule({ state: "new", interval: 0, ease: 250, reps: 0, lapses: 0 }, 4).interval).toBe(4);
  });
});

describe("vocabulaire : paquets", () => {
  it("paquet saisi à la main, séance du jour et répétition espacée", async () => {
    const f = await import("@/services/flashcards/flashcards");
    const r = await f.createDeck(db, userId, { source: "manual", title: "Unit 3", lang: "en", cards: [{ term: "to grow up", translation: "grandir" }, { term: "the city", translation: "la ville" }] });
    expect(r.generating).toBe(false);
    await f.addCards(db, userId, r.id, { text: "the suburbs = la banlieue\nthe city = doublon" });
    const deck = await f.getDeck(db, userId, r.id);
    expect(deck.cards.map((c) => c.term)).toEqual(["to grow up", "the city", "the suburbs"]);
    expect(deck.subject).toBe("Anglais");

    const s1 = await f.studySet(db, userId, { deck: r.id });
    expect(s1.cards).toHaveLength(3);
    expect(s1.cards[0].lang).toBe("en");
    const good = await f.reviewCard(db, userId, s1.cards[0].id, { grade: 3 });
    expect(good.interval).toBe(1);
    const bad = await f.reviewCard(db, userId, s1.cards[1].id, { grade: 1 });
    expect(bad.interval).toBe(0);
    // Entraînement en avance : une réussite ne repousse pas la date.
    const early = await f.reviewCard(db, userId, s1.cards[0].id, { grade: 4 });
    expect(early.interval).toBe(1);

    const s2 = await f.studySet(db, userId, { deck: r.id });
    expect(s2.cards.map((c) => c.term).sort()).toEqual(["the city", "the suburbs"]);
    expect((await f.studySet(db, userId, { deck: r.id, all: "1" })).cards).toHaveLength(3);

    const o = await f.overview(db, userId);
    const mine = o.decks.find((d) => d.id === r.id)!;
    expect(mine).toMatchObject({ total: 3, fresh: 1, due: 1 });
    expect(o.totals.studiedToday).toBe(2);

    await f.resetDeck(db, userId, r.id);
    expect((await f.overview(db, userId)).decks.find((d) => d.id === r.id)).toMatchObject({ fresh: 3, due: 0 });
    await f.deleteDeck(db, userId, r.id);
    await expect(f.getDeck(db, userId, r.id)).rejects.toThrow();
  });

  it("liste collée : cartes immédiates, sans IA", async () => {
    const calls = world();
    const f = await import("@/services/flashcards/flashcards");
    const r = await f.createDeck(db, userId, { source: "text", lang: "es", text: "la ciudad = la ville\nel barrio = le quartier\nel pueblo = le village" });
    expect(r.generating).toBe(false);
    expect((await f.getDeck(db, userId, r.id)).cards).toHaveLength(3);
    expect(calls.cards).toBe(0);
  });

  it("photo d'un cours : retranscription, lexique, puis fiche du cours", async () => {
    const calls = world();
    const f = await import("@/services/flashcards/flashcards");
    const scans = [{ data: Buffer.from("fake-jpeg"), mimeType: "image/jpeg", name: "page1.jpg" }];
    await expect(f.createScanDeck(db, userId, [{ data: Buffer.from("x"), mimeType: "text/html", name: "page.html" }], {})).rejects.toThrow(/ni une photo/);
    const r = await f.createScanDeck(db, userId, scans, { focus: "le lexique" });
    await f.runExtraction(db, userId, r.id, scans);
    const d = await f.getDeck(db, userId, r.id);
    expect(d.status).toBe("ready");
    expect(d.title).toBe("La ville");
    expect(d.lang).toBe("es");
    expect(d.cards.map((c) => c.term)).toEqual(["el ayuntamiento", "la canción", "crecer"]);
    expect(d.cards[2].note).toContain("crezco");
    expect(d.guideStatus).toBe("ready");
    expect(d.guide?.oral[0].question).toBe("¿Dónde vives?");
    expect(calls).toMatchObject({ scan: 1, cards: 1, guide: 1 });
    expect(calls.prompts.some((p) => p.includes("le lexique"))).toBe(true);
  });

  it("document sans vocabulaire : erreur claire", async () => {
    vi.stubGlobal("fetch", async () => json({ choices: [{ message: { content: JSON.stringify({ title: "Maths", lang: "en", isLanguageCourse: false, cards: [] }) } }], usage: {} }));
    const f = await import("@/services/flashcards/flashcards");
    const r = await f.createDeck(db, userId, { source: "text", text: "Le théorème de Pythagore : dans un triangle rectangle, le carré de l'hypoténuse est égal à la somme des carrés des deux autres côtés." });
    expect(r.generating).toBe(true);
    await f.runExtraction(db, userId, r.id);
    const d = await f.getDeck(db, userId, r.id);
    expect(d.status).toBe("error");
    expect(d.error).toMatch(/Aucun vocabulaire/);
  });
});

describe("quiz de langue", () => {
  it("une réponse sans accent est juste mais signalée ; la consigne de langue est envoyée à l'IA", async () => {
    world();
    const { schema } = await import("@/lib/db");
    const { answerQuestion, getQuiz } = await import("@/services/quiz/quiz");
    const { buildPrompt } = await import("@/services/quiz/generate");
    const today = new Date().toISOString().slice(0, 10);
    const [quiz] = await db
      .insert(schema.quizzes)
      .values({
        userId,
        kind: "custom",
        title: "Espagnol",
        status: "ready",
        forDate: today,
        questions: [
          { id: "q1", type: "open", prompt: "Comment dit-on « la chanson » en espagnol ?", answer: "la canción", explanation: "", subject: "Espagnol", topic: "vocabulaire", difficulty: 1, lang: "es", answerInLang: true },
          { id: "q2", type: "open", prompt: "Comment dit-on « la mairie » en espagnol ?", answer: "el ayuntamiento", explanation: "", subject: "Espagnol", topic: "vocabulaire", difficulty: 1, lang: "es", say: undefined },
        ],
      })
      .returning();
    const pub = await getQuiz(db, userId, quiz.id);
    expect(pub.questions[0]).toMatchObject({ lang: "es" });
    const a1 = await answerQuestion(db, userId, quiz.id, { questionId: "q1", value: "la cancion" });
    expect(a1.correct).toBe(true);
    expect(a1.feedback).toMatch(/accents/);
    expect(a1.reveal.answerInLang).toBe(true);
    const a2 = await answerQuestion(db, userId, quiz.id, { questionId: "q2", value: "la ciudad" });
    expect(a2.correct).toBe(false);

    const prompt = buildPrompt({ kind: "custom", docs: [{ id: "d", name: "Unit 3", path: "Etudes / Anglais", text: "The city is big.", fresh: null, minor: false }], count: 10, lang: "en" });
    expect(prompt).toContain("Cours d'anglais");
  });
});
