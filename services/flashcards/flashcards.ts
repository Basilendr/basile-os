import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type DB } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { log } from "@/lib/log";
import { isServiceConnected } from "../google/oauth";
import { aiSettings } from "../ai/context";
import { QuizSourceInput, loadDoc, withPaths } from "../quiz/sources";
import { localNow, shiftDate, zonedMidnight } from "../quiz/time";
import { createCustom, userTz } from "../quiz/quiz";
import { LANGS, LANG_CODES, MASTERED, isLang, langOf, parseLexicon, sanitizeCards, schedule, type CardDraft, type Grade, type LangCode } from "./core";
import { buildGuide, extractCards, transcribe } from "./extract";

/**
 * Vocabulaire de langues vivantes : paquets de cartes tirés d'un cours (Drive, photo, texte collé)
 * ou saisis à la main, révisés en répétition espacée, et fiche pour apprendre le cours.
 */

const D = schema.flashDecks;
const C = schema.flashCards;
type Deck = typeof D.$inferSelect;
type Card = typeof C.$inferSelect;

/** Nouvelles cartes proposées par séance (le reste attend le lendemain). */
const NEW_PER_SESSION = 20;
const running = new Set<string>();

async function today(db: DB, userId: string) {
  const tz = await userTz(db, userId);
  return { tz, date: localNow(tz).date };
}

async function loadDeck(db: DB, userId: string, id: string) {
  const [d] = await db.select().from(D).where(and(eq(D.userId, userId), eq(D.id, id)));
  if (!d) throw notFound("Paquet");
  return d;
}

const LangZ = z.enum(LANG_CODES as [LangCode, ...LangCode[]]);
const CardZ = z.object({
  term: z.string().trim().min(1, "Mot manquant").max(200),
  translation: z.string().trim().min(1, "Traduction manquante").max(200),
  example: z.string().trim().max(300).nullish(),
  exampleFr: z.string().trim().max(300).nullish(),
  note: z.string().trim().max(200).nullish(),
});

export const CreateInput = z.discriminatedUnion("source", [
  z.object({ source: z.literal("drive"), doc: QuizSourceInput, focus: z.string().trim().max(300).optional(), lang: LangZ.optional() }),
  z.object({ source: z.literal("text"), text: z.string().trim().min(10, "Colle au moins quelques mots").max(60_000), title: z.string().trim().max(120).optional(), focus: z.string().trim().max(300).optional(), lang: LangZ.optional() }),
  z.object({ source: z.literal("manual"), title: z.string().trim().min(1, "Donne un titre au paquet").max(120), lang: LangZ, cards: z.array(CardZ).max(300).default([]) }),
]);

/* ---------------------------------------------------------------- vue d'ensemble */

export async function overview(db: DB, userId: string) {
  const { tz, date } = await today(db, userId);
  await failStuck(db, userId);
  const decks = await db.select().from(D).where(eq(D.userId, userId)).orderBy(desc(D.createdAt));
  const counts = await db
    .select({
      deckId: C.deckId,
      total: sql<number>`count(*)::int`,
      fresh: sql<number>`count(*) filter (where ${C.state} = 'new')::int`,
      due: sql<number>`count(*) filter (where ${C.state} <> 'new' and ${C.dueDate} <= ${date})::int`,
      mastered: sql<number>`count(*) filter (where ${C.interval} >= ${MASTERED})::int`,
    })
    .from(C)
    .where(eq(C.userId, userId))
    .groupBy(C.deckId);
  const by = new Map(counts.map((c) => [c.deckId, c]));
  const [studied] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(C)
    .where(and(eq(C.userId, userId), gte(C.lastReviewedAt, zonedMidnight(date, tz))));
  const list = decks.map((d) => {
    const c = by.get(d.id);
    return {
      id: d.id,
      title: d.title,
      subject: d.subject,
      lang: d.lang,
      source: d.source,
      status: d.status,
      error: d.error,
      guide: d.guideStatus,
      createdAt: d.createdAt.toISOString(),
      total: c?.total ?? 0,
      fresh: c?.fresh ?? 0,
      due: c?.due ?? 0,
      mastered: c?.mastered ?? 0,
    };
  });
  const [drive, ai] = await Promise.all([isServiceConnected(db, userId, "drive"), aiSettings(db, userId)]);
  return {
    date,
    ready: { drive, ai: ai.configured },
    decks: list,
    totals: {
      due: list.reduce((s, d) => s + d.due, 0),
      fresh: list.reduce((s, d) => s + d.fresh, 0),
      total: list.reduce((s, d) => s + d.total, 0),
      mastered: list.reduce((s, d) => s + d.mastered, 0),
      studiedToday: studied?.n ?? 0,
    },
  };
}

/** Cartes à revoir aujourd'hui (pour l'accueil et les quiz). */
export async function dueCount(db: DB, userId: string) {
  const { date } = await today(db, userId);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(C)
    .where(and(eq(C.userId, userId), sql`${C.state} <> 'new'`, lte(C.dueDate, date)));
  return r?.n ?? 0;
}

function publicCard(c: Card, date: string) {
  return {
    id: c.id,
    term: c.term,
    translation: c.translation,
    example: c.example,
    exampleFr: c.exampleFr,
    note: c.note,
    kind: c.kind,
    state: c.state,
    interval: c.interval,
    ease: c.ease,
    reps: c.reps,
    lapses: c.lapses,
    dueDate: c.dueDate,
    due: c.state !== "new" && !!c.dueDate && c.dueDate <= date,
  };
}

export async function getDeck(db: DB, userId: string, id: string) {
  const { date } = await today(db, userId);
  const d = await loadDeck(db, userId, id);
  const cards = await db.select().from(C).where(and(eq(C.userId, userId), eq(C.deckId, id))).orderBy(asc(C.position), asc(C.createdAt));
  return {
    id: d.id,
    title: d.title,
    subject: d.subject,
    lang: d.lang,
    source: d.source,
    sources: d.sources,
    focus: d.focus,
    status: d.status,
    error: d.error,
    hasText: d.text.trim().length > 0,
    guide: d.guide,
    guideStatus: d.guideStatus,
    date,
    cards: cards.map((c) => publicCard(c, date)),
  };
}

/* ---------------------------------------------------------------- création */

export async function createDeck(db: DB, userId: string, raw: z.input<typeof CreateInput>) {
  const v = CreateInput.parse(raw);
  if (v.source === "manual") {
    const [d] = await db.insert(D).values({ userId, title: v.title, lang: v.lang, subject: LANG_LABEL(v.lang), source: "manual", status: "ready" }).returning();
    if (v.cards.length) await insertCards(db, userId, d.id, sanitizeCards(v.cards, 300));
    return { id: d.id, generating: false };
  }
  if (v.source === "text") {
    // Une liste « mot = traduction » devient directement un paquet ; un texte est confié à l'IA.
    const pairs = parseLexicon(v.text);
    if (pairs && v.lang) {
      const [d] = await db.insert(D).values({ userId, title: v.title || "Mon vocabulaire", lang: v.lang, subject: LANG_LABEL(v.lang), source: "text", text: v.text, status: "ready" }).returning();
      await insertCards(db, userId, d.id, sanitizeCards(pairs, 300));
      return { id: d.id, generating: false };
    }
    await requireAi(db, userId);
    const [d] = await db.insert(D).values({ userId, title: v.title || "", lang: v.lang ?? "en", subject: v.lang ? LANG_LABEL(v.lang) : null, source: "text", text: v.text, focus: v.focus || null, status: "generating" }).returning();
    return { id: d.id, generating: true };
  }
  if (!(await isServiceConnected(db, userId, "drive"))) throw new AppError("not_configured", "Connecte Google Drive pour choisir un document.");
  await requireAi(db, userId);
  const [d] = await db
    .insert(D)
    .values({ userId, title: "", lang: v.lang ?? "en", subject: v.lang ? LANG_LABEL(v.lang) : null, source: "drive", sources: [{ id: v.doc.id, name: v.doc.name, mimeType: v.doc.mimeType }], focus: v.focus || null, status: "generating" })
    .returning();
  return { id: d.id, generating: true };
}

const LANG_LABEL = (l: string) => (isLang(l) ? LANGS[l].label : null);

export type Scan = { data: Buffer; mimeType: string; name: string };
const SCAN_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

/** Photos ou PDF d'un cours : retranscrits par l'IA puis transformés en cartes (en arrière-plan). */
export async function createScanDeck(db: DB, userId: string, files: Scan[], o: { title?: string; focus?: string; lang?: string }) {
  if (!files.length) throw new AppError("bad_request", "Ajoute au moins une photo de ton cours.");
  if (files.length > 8) throw new AppError("bad_request", "8 photos au maximum à la fois.");
  for (const f of files) {
    if (!SCAN_TYPES.test(f.mimeType)) throw new AppError("bad_request", `« ${f.name} » n'est ni une photo ni un PDF.`);
    if (f.data.length > 12 * 1024 * 1024) throw new AppError("bad_request", `« ${f.name} » est trop lourd (12 Mo max).`);
  }
  await requireAi(db, userId);
  const lang = o.lang && isLang(o.lang) ? o.lang : "en";
  const [d] = await db
    .insert(D)
    .values({ userId, title: o.title?.trim().slice(0, 120) || "", lang, subject: o.lang && isLang(o.lang) ? LANG_LABEL(lang) : null, source: "scan", sources: files.map((f, i) => ({ id: `scan-${i + 1}`, name: f.name.slice(0, 200) })), focus: o.focus?.trim().slice(0, 300) || null, status: "generating" })
    .returning();
  return { id: d.id, generating: true };
}

async function requireAi(db: DB, userId: string) {
  if (!(await aiSettings(db, userId)).configured) throw new AppError("not_configured", "L'IA n'est pas configurée : ajoute une clé dans les paramètres pour lire tes cours.");
}

async function insertCards(db: DB, userId: string, deckId: string, drafts: CardDraft[]) {
  if (!drafts.length) return 0;
  const [last] = await db.select({ p: sql<number>`coalesce(max(${C.position}), -1)::int` }).from(C).where(eq(C.deckId, deckId));
  const existing = await db.select({ term: C.term }).from(C).where(eq(C.deckId, deckId));
  const known = new Set(existing.map((e) => e.term.toLowerCase()));
  const rows = drafts
    .filter((c) => !known.has(c.term.toLowerCase()))
    .map((c, i) => ({ userId, deckId, term: c.term, translation: c.translation, example: c.example ?? null, exampleFr: c.exampleFr ?? null, note: c.note ?? null, kind: c.kind ?? null, position: (last?.p ?? -1) + 1 + i }));
  if (rows.length) await db.insert(C).values(rows);
  return rows.length;
}

/** Lit le cours, en tire le lexique avec l'IA, puis prépare la fiche du cours. */
export async function runExtraction(db: DB, userId: string, deckId: string, scans?: Scan[]) {
  if (running.has(deckId)) return;
  running.add(deckId);
  const set = (v: Partial<Deck>) => db.update(D).set({ ...v, updatedAt: new Date() }).where(eq(D.id, deckId));
  try {
    const deck = await loadDeck(db, userId, deckId);
    await set({ status: "generating", error: null });
    let text = deck.text;
    let name = deck.title || "Cours";
    let path = "";
    if (deck.source === "drive") {
      const { date } = await today(db, userId);
      const [f] = await withPaths(db, userId, deck.sources.map((s) => ({ id: s.id, name: s.name, mimeType: s.mimeType ?? "" })));
      const doc = await loadDoc(db, userId, f, date);
      if (doc.error) throw new AppError("bad_request", doc.error);
      text = doc.text;
      name = f.name;
      path = f.path ?? "";
      await set({ text: text.slice(0, 120_000), subject: deck.subject ?? f.subject ?? null });
      deck.subject = deck.subject ?? f.subject ?? null;
    } else if (deck.source === "scan") {
      if (!scans?.length && !text.trim()) throw new AppError("bad_request", "Les photos ne sont plus disponibles : recommence le scan.");
      if (scans?.length) {
        const parts: string[] = [];
        for (const s of scans) parts.push(await transcribe(db, userId, s.data, s.mimeType));
        text = parts.join("\n\n");
        await set({ text: text.slice(0, 120_000) });
      }
    }
    if (text.replace(/\s+/g, " ").trim().length < 10) throw new AppError("bad_request", "Ce document ne contient pas de texte lisible.");
    // Lexique déjà rédigé « mot = traduction » : pas besoin de l'IA pour les cartes.
    const pairs = deck.source !== "drive" ? parseLexicon(text) : null;
    const hint = langOf(deck.subject, path, name);
    const r = pairs && hint ? { title: deck.title || "Mon vocabulaire", lang: hint as LangCode, cards: sanitizeCards(pairs, 300) } : await extractCards(db, userId, { text, name, path, focus: deck.focus, lang: hint });
    if (!r.cards.length) throw new AppError("bad_request", "Aucun vocabulaire de langue étrangère trouvé dans ce document : choisis un cours de langue, ou saisis tes mots à la main.");
    const lang = hint && isLang(hint) ? hint : r.lang;
    await insertCards(db, userId, deckId, r.cards);
    await set({ status: "ready", title: deck.title || r.title || name, lang, subject: deck.subject ?? LANG_LABEL(lang), error: null, guideStatus: "generating" });
    await runGuide(db, userId, deckId);
  } catch (e) {
    log.warn("flashcards.extract_failed", { deckId, error: String(e) });
    await set({ status: "error", error: e instanceof AppError ? e.message : "La lecture du cours a échoué." }).catch(() => null);
  } finally {
    running.delete(deckId);
  }
}

/** Fiche pour apprendre le cours (résumé, phrases clés, grammaire, oral). */
export async function runGuide(db: DB, userId: string, deckId: string) {
  const key = `guide:${deckId}`;
  if (running.has(key)) return;
  running.add(key);
  const set = (v: Partial<Deck>) => db.update(D).set({ ...v, updatedAt: new Date() }).where(eq(D.id, deckId));
  try {
    const deck = await loadDeck(db, userId, deckId);
    const cards = await db.select({ term: C.term, translation: C.translation }).from(C).where(eq(C.deckId, deckId)).orderBy(asc(C.position));
    if (!deck.text.trim() && cards.length < 3) throw new AppError("bad_request", "Ajoute quelques mots avant de demander la fiche.");
    await set({ guideStatus: "generating" });
    const guide = await buildGuide(db, userId, { lang: deck.lang, title: deck.title, text: deck.text, cards, focus: deck.focus });
    await set({ guide, guideStatus: "ready" });
  } catch (e) {
    log.warn("flashcards.guide_failed", { deckId, error: String(e) });
    await set({ guideStatus: "error" }).catch(() => null);
  } finally {
    running.delete(key);
  }
}

export async function prepareGuide(db: DB, userId: string, deckId: string) {
  await loadDeck(db, userId, deckId);
  await requireAi(db, userId);
  await db.update(D).set({ guideStatus: "generating", updatedAt: new Date() }).where(eq(D.id, deckId));
  return { ok: true };
}

/** Paquets restés « en préparation » après un redémarrage : marqués en erreur pour pouvoir relancer. */
async function failStuck(db: DB, userId: string) {
  const old = new Date(Date.now() - 6 * 60_000);
  const stuck = await db
    .select({ id: D.id, status: D.status, guide: D.guideStatus })
    .from(D)
    .where(and(eq(D.userId, userId), or(eq(D.status, "generating"), eq(D.guideStatus, "generating")), lte(D.updatedAt, old)));
  for (const s of stuck) {
    if (s.status === "generating" && !running.has(s.id)) await db.update(D).set({ status: "error", error: "La lecture du cours a été interrompue : relance-la." }).where(eq(D.id, s.id));
    if (s.guide === "generating" && !running.has(`guide:${s.id}`)) await db.update(D).set({ guideStatus: "error" }).where(eq(D.id, s.id));
  }
}

export async function retryDeck(db: DB, userId: string, deckId: string) {
  const d = await loadDeck(db, userId, deckId);
  if (d.status === "ready") throw new AppError("conflict", "Ce paquet est déjà prêt.");
  if (d.source === "scan" && !d.text.trim()) throw new AppError("bad_request", "Les photos ne sont plus disponibles : supprime ce paquet et recommence le scan.");
  await db.update(D).set({ status: "generating", error: null, updatedAt: new Date() }).where(eq(D.id, deckId));
  return { ok: true };
}

/* ---------------------------------------------------------------- modification */

export const DeckPatch = z.object({ title: z.string().trim().min(1).max(120).optional(), lang: LangZ.optional() });

export async function updateDeck(db: DB, userId: string, deckId: string, raw: z.input<typeof DeckPatch>) {
  const v = DeckPatch.parse(raw);
  await loadDeck(db, userId, deckId);
  await db.update(D).set({ ...v, ...(v.lang ? { subject: LANG_LABEL(v.lang) } : {}), updatedAt: new Date() }).where(eq(D.id, deckId));
  return { ok: true };
}

export async function deleteDeck(db: DB, userId: string, deckId: string) {
  await loadDeck(db, userId, deckId);
  await db.delete(D).where(eq(D.id, deckId));
  return { ok: true };
}

export const AddInput = z.object({ cards: z.array(CardZ).min(1).max(300).optional(), text: z.string().max(30_000).optional() });

/** Ajout de mots : un par un ou en collant une liste « mot = traduction ». */
export async function addCards(db: DB, userId: string, deckId: string, raw: z.input<typeof AddInput>) {
  const v = AddInput.parse(raw);
  await loadDeck(db, userId, deckId);
  const drafts = v.cards ?? (v.text ? parseLexicon(v.text) : null);
  if (!drafts?.length) throw new AppError("bad_request", "Écris une paire par ligne : mot = traduction.");
  const added = await insertCards(db, userId, deckId, sanitizeCards(drafts, 300));
  return { added };
}

export const CardPatch = CardZ.partial();

async function loadCard(db: DB, userId: string, cardId: string) {
  const [c] = await db.select().from(C).where(and(eq(C.userId, userId), eq(C.id, cardId)));
  if (!c) throw notFound("Carte");
  return c;
}

export async function updateCard(db: DB, userId: string, cardId: string, raw: z.input<typeof CardPatch>) {
  const v = CardPatch.parse(raw);
  await loadCard(db, userId, cardId);
  await db.update(C).set({ ...v, updatedAt: new Date() }).where(eq(C.id, cardId));
  return { ok: true };
}

export async function deleteCard(db: DB, userId: string, cardId: string) {
  await loadCard(db, userId, cardId);
  await db.delete(C).where(eq(C.id, cardId));
  return { ok: true };
}

/** Remet les cartes d'un paquet à zéro (« tout réapprendre »). */
export async function resetDeck(db: DB, userId: string, deckId: string) {
  await loadDeck(db, userId, deckId);
  await db.update(C).set({ state: "new", interval: 0, ease: 250, reps: 0, lapses: 0, dueDate: null, updatedAt: new Date() }).where(and(eq(C.userId, userId), eq(C.deckId, deckId)));
  return { ok: true };
}

/* ---------------------------------------------------------------- révision */

export const StudyQuery = z.object({ deck: z.uuid().optional(), all: z.enum(["0", "1"]).optional() });

/**
 * Cartes d'une séance : celles à revoir aujourd'hui, puis des nouvelles (20 au plus).
 * `all` : tout le paquet, pour s'entraîner avant un contrôle.
 */
export async function studySet(db: DB, userId: string, raw: z.input<typeof StudyQuery>) {
  const v = StudyQuery.parse(raw);
  const { date } = await today(db, userId);
  const scope = v.deck ? and(eq(C.userId, userId), eq(C.deckId, v.deck)) : eq(C.userId, userId);
  if (v.deck) await loadDeck(db, userId, v.deck);
  let rows: Card[];
  if (v.all === "1") rows = await db.select().from(C).where(scope).orderBy(asc(C.position));
  else {
    const due = await db.select().from(C).where(and(scope, sql`${C.state} <> 'new'`, lte(C.dueDate, date))).orderBy(asc(C.dueDate), desc(C.lapses)).limit(200);
    const fresh = await db.select().from(C).where(and(scope, eq(C.state, "new"))).orderBy(asc(C.createdAt), asc(C.position)).limit(NEW_PER_SESSION);
    rows = [...due, ...fresh];
  }
  const deckIds = [...new Set(rows.map((r) => r.deckId))];
  const decks = deckIds.length ? await db.select({ id: D.id, lang: D.lang, title: D.title }).from(D).where(inArray(D.id, deckIds)) : [];
  const info = new Map(decks.map((d) => [d.id, d]));
  // Toutes les traductions du paquet : servent de propositions aux QCM.
  const pool = v.deck ? await db.select({ term: C.term, translation: C.translation }).from(C).where(eq(C.deckId, v.deck)) : rows.map((r) => ({ term: r.term, translation: r.translation }));
  return {
    date,
    cards: rows.map((c) => ({ ...publicCard(c, date), deckId: c.deckId, lang: info.get(c.deckId)?.lang ?? "en", deckTitle: info.get(c.deckId)?.title ?? "" })),
    pool: pool.slice(0, 400),
  };
}

export const ReviewInput = z.object({ grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) });

/** Note une carte (1 à revoir · 2 difficile · 3 bien · 4 facile) et calcule sa prochaine date. */
export async function reviewCard(db: DB, userId: string, cardId: string, raw: z.input<typeof ReviewInput>) {
  const { grade } = ReviewInput.parse(raw);
  const { date } = await today(db, userId);
  const c = await loadCard(db, userId, cardId);
  const now = new Date();
  // Entraînement sur une carte pas encore due : une réussite ne repousse pas sa date, un oubli la ramène.
  const early = c.state !== "new" && !!c.dueDate && c.dueDate > date;
  if (early && grade > 1) {
    await db.update(C).set({ lastReviewedAt: now }).where(eq(C.id, cardId));
    return { id: cardId, interval: c.interval, dueDate: c.dueDate };
  }
  const next = schedule(c, grade as Grade);
  const dueDate = shiftDate(date, next.interval);
  await db.update(C).set({ ...next, dueDate, lastReviewedAt: now, updatedAt: now }).where(eq(C.id, cardId));
  return { id: cardId, interval: next.interval, dueDate };
}

/* ---------------------------------------------------------------- quiz */

/** Quiz complet sur le cours d'origine (document Drive) : compréhension, grammaire, traduction. */
export async function quizFromDeck(db: DB, userId: string, deckId: string) {
  const d = await loadDeck(db, userId, deckId);
  if (d.source !== "drive" || !d.sources.length) throw new AppError("bad_request", "Le quiz complet n'est possible que pour un cours venu de Google Drive : utilise le mode QCM des cartes.");
  return createCustom(db, userId, { sources: d.sources.map((s) => ({ id: s.id, name: s.name, mimeType: s.mimeType })), count: 12, difficulty: "normal", focus: d.focus ?? undefined, title: d.title ? `${d.title} · quiz` : undefined });
}

