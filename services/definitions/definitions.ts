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
import { userTz } from "../quiz/quiz";
import { MASTERED, schedule, type Grade } from "../flashcards/core";
import { autoKeywords, cleanKeywords, flat, parseDefinitions, sanitizeDefs, type DefDraft } from "./core";
import { analyzeKeywords, extractDefinitions } from "./extract";

/**
 * Définitions à apprendre (SES, histoire, philo…) : paquets collés, tirés d'un cours Drive ou saisis
 * à la main ; l'IA repère les mots importants de chaque définition ; révision en répétition espacée.
 */

const D = schema.defDecks;
const C = schema.defCards;
type Deck = typeof D.$inferSelect;
type Card = typeof C.$inferSelect;

const NEW_PER_SESSION = 15;
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

const CardZ = z.object({
  term: z.string().trim().min(1, "Notion manquante").max(200),
  definition: z.string().trim().min(1, "Définition manquante").max(1500),
  keywords: z.array(z.string().trim().min(1).max(80)).max(8).nullish(),
});

export const CreateInput = z.discriminatedUnion("source", [
  z.object({ source: z.literal("drive"), doc: QuizSourceInput, focus: z.string().trim().max(300).optional(), title: z.string().trim().max(120).optional(), subject: z.string().trim().max(60).optional() }),
  z.object({ source: z.literal("text"), text: z.string().trim().min(5, "Colle au moins une définition").max(60_000), title: z.string().trim().max(120).optional(), subject: z.string().trim().max(60).optional(), focus: z.string().trim().max(300).optional() }),
  z.object({ source: z.literal("manual"), title: z.string().trim().min(1, "Donne un titre au paquet").max(120), subject: z.string().trim().max(60).optional(), cards: z.array(CardZ).max(300).default([]) }),
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
      source: d.source,
      status: d.status,
      error: d.error,
      keywords: d.keywordsStatus,
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

function publicCard(c: Card, date: string) {
  return {
    id: c.id,
    term: c.term,
    definition: c.definition,
    keywords: c.keywords,
    keywordsBy: c.keywordsBy,
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
    source: d.source,
    sources: d.sources,
    focus: d.focus,
    status: d.status,
    error: d.error,
    keywordsStatus: d.keywordsStatus,
    date,
    cards: cards.map((c) => publicCard(c, date)),
  };
}

/* ---------------------------------------------------------------- création */

async function hasAi(db: DB, userId: string) {
  return (await aiSettings(db, userId)).configured;
}

async function requireAi(db: DB, userId: string) {
  if (!(await hasAi(db, userId))) throw new AppError("not_configured", "L'IA n'est pas configurée : ajoute une clé dans les paramètres, ou colle tes définitions sous la forme « notion : définition ».");
}

/**
 * Nouveau paquet. Une liste « notion : définition » est prête tout de suite (mots clés calculés sur place,
 * puis affinés par l'IA en arrière-plan). Un cours (Drive ou texte libre) est lu par l'IA.
 * `analyze` : l'analyse des mots clés est à lancer ; `generating` : l'extraction est à lancer.
 */
export async function createDeck(db: DB, userId: string, raw: z.input<typeof CreateInput>) {
  const v = CreateInput.parse(raw);
  const subject = v.subject?.trim() || null;
  if (v.source === "manual") {
    const [d] = await db.insert(D).values({ userId, title: v.title, subject, source: "manual", status: "ready" }).returning();
    const added = v.cards.length ? await insertCards(db, userId, d.id, sanitizeDefs(v.cards, 300)) : 0;
    return { id: d.id, generating: false, analyze: added > 0 && (await markAnalyzing(db, userId, d.id)) };
  }
  if (v.source === "text") {
    const defs = parseDefinitions(v.text);
    if (defs) {
      const [d] = await db.insert(D).values({ userId, title: v.title || "Mes définitions", subject, source: "text", text: v.text, status: "ready" }).returning();
      await insertCards(db, userId, d.id, sanitizeDefs(defs, 300));
      return { id: d.id, generating: false, analyze: await markAnalyzing(db, userId, d.id) };
    }
    await requireAi(db, userId);
    const [d] = await db.insert(D).values({ userId, title: v.title || "", subject, source: "text", text: v.text, focus: v.focus || null, status: "generating" }).returning();
    return { id: d.id, generating: true, analyze: false };
  }
  if (!(await isServiceConnected(db, userId, "drive"))) throw new AppError("not_configured", "Connecte Google Drive pour choisir un document.");
  await requireAi(db, userId);
  const [d] = await db
    .insert(D)
    .values({ userId, title: v.title || "", subject, source: "drive", sources: [{ id: v.doc.id, name: v.doc.name, mimeType: v.doc.mimeType }], focus: v.focus || null, status: "generating" })
    .returning();
  return { id: d.id, generating: true, analyze: false };
}

/** Marque le paquet « analyse en cours » si l'IA est disponible. */
async function markAnalyzing(db: DB, userId: string, deckId: string) {
  if (!(await hasAi(db, userId))) return false;
  await db.update(D).set({ keywordsStatus: "generating", updatedAt: new Date() }).where(eq(D.id, deckId));
  return true;
}

async function insertCards(db: DB, userId: string, deckId: string, drafts: DefDraft[]) {
  if (!drafts.length) return 0;
  const [last] = await db.select({ p: sql<number>`coalesce(max(${C.position}), -1)::int` }).from(C).where(eq(C.deckId, deckId));
  const existing = await db.select({ term: C.term }).from(C).where(eq(C.deckId, deckId));
  const known = new Set(existing.map((e) => flat(e.term)));
  const rows = drafts
    .filter((c) => !known.has(flat(c.term)))
    .map((c, i) => {
      const given = c.keywords?.length ? cleanKeywords(c.keywords, c.definition) : [];
      return {
        userId,
        deckId,
        term: c.term,
        definition: c.definition,
        keywords: given.length ? given : autoKeywords(c.term, c.definition),
        keywordsBy: given.length ? "ai" : "auto",
        position: (last?.p ?? -1) + 1 + i,
      };
    });
  if (rows.length) await db.insert(C).values(rows);
  return rows.length;
}

/** Lit le cours et en tire les définitions avec l'IA (mots clés compris). */
export async function runExtraction(db: DB, userId: string, deckId: string) {
  if (running.has(deckId)) return;
  running.add(deckId);
  const set = (v: Partial<Deck>) => db.update(D).set({ ...v, updatedAt: new Date() }).where(eq(D.id, deckId));
  try {
    const deck = await loadDeck(db, userId, deckId);
    await set({ status: "generating", error: null });
    let text = deck.text;
    let name = deck.title || "Cours";
    let path = "";
    let subject = deck.subject;
    if (deck.source === "drive") {
      const { date } = await today(db, userId);
      const [f] = await withPaths(db, userId, deck.sources.map((s) => ({ id: s.id, name: s.name, mimeType: s.mimeType ?? "" })));
      const doc = await loadDoc(db, userId, f, date);
      if (doc.error) throw new AppError("bad_request", doc.error);
      text = doc.text;
      name = f.name;
      path = f.path ?? "";
      subject = subject ?? f.subject ?? null;
      await set({ text: text.slice(0, 120_000), subject });
    }
    if (text.replace(/\s+/g, " ").trim().length < 5) throw new AppError("bad_request", "Ce document ne contient pas de texte lisible.");
    const r = await extractDefinitions(db, userId, { text, name, path, focus: deck.focus });
    if (!r.cards.length) throw new AppError("bad_request", "Aucune définition trouvée dans ce document : choisis un autre cours, ou colle tes définitions.");
    await insertCards(db, userId, deckId, r.cards);
    await set({ status: "ready", title: deck.title || r.title || name, subject: subject ?? r.subject, error: null, keywordsStatus: "ready" });
  } catch (e) {
    log.warn("definitions.extract_failed", { deckId, error: String(e) });
    await set({ status: "error", error: e instanceof AppError ? e.message : "La lecture du cours a échoué." }).catch(() => null);
  } finally {
    running.delete(deckId);
  }
}

/**
 * L'IA repère les mots importants des définitions dont les mots clés ont été calculés sur place.
 * En cas d'échec, les mots clés calculés sur place restent : le paquet reste utilisable.
 */
export async function runKeywords(db: DB, userId: string, deckId: string, all = false) {
  const key = `kw:${deckId}`;
  if (running.has(key)) return;
  running.add(key);
  const set = (v: Partial<Deck>) => db.update(D).set({ ...v, updatedAt: new Date() }).where(eq(D.id, deckId));
  try {
    await loadDeck(db, userId, deckId);
    const cards = await db
      .select()
      .from(C)
      .where(and(eq(C.deckId, deckId), all ? sql`${C.keywordsBy} <> 'manual'` : eq(C.keywordsBy, "auto")))
      .orderBy(asc(C.position));
    if (cards.length) {
      await set({ keywordsStatus: "generating" });
      const found = await analyzeKeywords(db, userId, cards);
      for (const [i, kw] of found) await db.update(C).set({ keywords: kw, keywordsBy: "ai", updatedAt: new Date() }).where(eq(C.id, cards[i].id));
    }
    await set({ keywordsStatus: "ready" });
  } catch (e) {
    log.warn("definitions.keywords_failed", { deckId, error: String(e) });
    await set({ keywordsStatus: "error" }).catch(() => null);
  } finally {
    running.delete(key);
  }
}

/** Relance l'analyse des mots clés (toutes les définitions sauf celles corrigées à la main). */
export async function prepareKeywords(db: DB, userId: string, deckId: string) {
  await loadDeck(db, userId, deckId);
  await requireAi(db, userId);
  await db.update(D).set({ keywordsStatus: "generating", updatedAt: new Date() }).where(eq(D.id, deckId));
  return { ok: true };
}

/** Paquets restés « en préparation » après un redémarrage. */
async function failStuck(db: DB, userId: string) {
  const old = new Date(Date.now() - 6 * 60_000);
  const stuck = await db
    .select({ id: D.id, status: D.status, kw: D.keywordsStatus })
    .from(D)
    .where(and(eq(D.userId, userId), or(eq(D.status, "generating"), eq(D.keywordsStatus, "generating")), lte(D.updatedAt, old)));
  for (const s of stuck) {
    if (s.status === "generating" && !running.has(s.id)) await db.update(D).set({ status: "error", error: "La lecture du cours a été interrompue : relance-la." }).where(eq(D.id, s.id));
    if (s.kw === "generating" && !running.has(`kw:${s.id}`)) await db.update(D).set({ keywordsStatus: "error" }).where(eq(D.id, s.id));
  }
}

export async function retryDeck(db: DB, userId: string, deckId: string) {
  const d = await loadDeck(db, userId, deckId);
  if (d.status === "ready") throw new AppError("conflict", "Ce paquet est déjà prêt.");
  await db.update(D).set({ status: "generating", error: null, updatedAt: new Date() }).where(eq(D.id, deckId));
  return { ok: true };
}

/* ---------------------------------------------------------------- modification */

export const DeckPatch = z.object({ title: z.string().trim().min(1).max(120).optional(), subject: z.string().trim().max(60).nullish() });

export async function updateDeck(db: DB, userId: string, deckId: string, raw: z.input<typeof DeckPatch>) {
  const v = DeckPatch.parse(raw);
  await loadDeck(db, userId, deckId);
  await db.update(D).set({ ...v, ...(v.subject !== undefined ? { subject: v.subject || null } : {}), updatedAt: new Date() }).where(eq(D.id, deckId));
  return { ok: true };
}

export async function deleteDeck(db: DB, userId: string, deckId: string) {
  await loadDeck(db, userId, deckId);
  await db.delete(D).where(eq(D.id, deckId));
  return { ok: true };
}

export const AddInput = z.object({ cards: z.array(CardZ).min(1).max(300).optional(), text: z.string().max(60_000).optional() });

/** Ajout de définitions : une par une ou en collant une liste « notion : définition ». */
export async function addCards(db: DB, userId: string, deckId: string, raw: z.input<typeof AddInput>) {
  const v = AddInput.parse(raw);
  await loadDeck(db, userId, deckId);
  const drafts = v.cards ?? (v.text ? parseDefinitions(v.text) : null);
  if (!drafts?.length) throw new AppError("bad_request", "Écris une définition par ligne : notion : définition.");
  const added = await insertCards(db, userId, deckId, sanitizeDefs(drafts, 300));
  return { added, analyze: added > 0 && (await markAnalyzing(db, userId, deckId)) };
}

export const CardPatch = z.object({
  term: z.string().trim().min(1).max(200).optional(),
  definition: z.string().trim().min(1).max(1500).optional(),
  keywords: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
});

async function loadCard(db: DB, userId: string, cardId: string) {
  const [c] = await db.select().from(C).where(and(eq(C.userId, userId), eq(C.id, cardId)));
  if (!c) throw notFound("Carte");
  return c;
}

/**
 * Modifie une définition. Mots clés donnés : gardés (seulement ceux présents dans la définition).
 * Définition changée sans mots clés : recalculés sur place, puis l'IA les affine (`analyze`).
 */
export async function updateCard(db: DB, userId: string, cardId: string, raw: z.input<typeof CardPatch>) {
  const v = CardPatch.parse(raw);
  const c = await loadCard(db, userId, cardId);
  const term = v.term ?? c.term;
  const definition = v.definition ?? c.definition;
  let keywords = c.keywords;
  let keywordsBy = c.keywordsBy;
  let analyze = false;
  if (v.keywords) {
    keywords = cleanKeywords(v.keywords, definition);
    keywordsBy = "manual";
  } else if (v.definition !== undefined && v.definition !== c.definition) {
    const kept = c.keywordsBy === "manual" ? cleanKeywords(c.keywords, definition) : [];
    if (kept.length) keywords = kept;
    else {
      keywords = autoKeywords(term, definition);
      keywordsBy = "auto";
      analyze = await markAnalyzing(db, userId, c.deckId);
    }
  }
  await db.update(C).set({ term, definition, keywords, keywordsBy, updatedAt: new Date() }).where(eq(C.id, cardId));
  return { ok: true, analyze, deckId: c.deckId };
}

export async function deleteCard(db: DB, userId: string, cardId: string) {
  await loadCard(db, userId, cardId);
  await db.delete(C).where(eq(C.id, cardId));
  return { ok: true };
}

export async function resetDeck(db: DB, userId: string, deckId: string) {
  await loadDeck(db, userId, deckId);
  await db.update(C).set({ state: "new", interval: 0, ease: 250, reps: 0, lapses: 0, dueDate: null, updatedAt: new Date() }).where(and(eq(C.userId, userId), eq(C.deckId, deckId)));
  return { ok: true };
}

/* ---------------------------------------------------------------- révision */

export const StudyQuery = z.object({ deck: z.uuid().optional(), all: z.enum(["0", "1"]).optional() });

/** Cartes d'une séance : à revoir aujourd'hui, puis des nouvelles ; `all` : tout le paquet. */
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
  const decks = deckIds.length ? await db.select({ id: D.id, title: D.title }).from(D).where(inArray(D.id, deckIds)) : [];
  const info = new Map(decks.map((d) => [d.id, d]));
  // Toutes les définitions du paquet : servent de propositions aux QCM.
  const pool = v.deck ? await db.select({ term: C.term, definition: C.definition }).from(C).where(eq(C.deckId, v.deck)) : rows.map((r) => ({ term: r.term, definition: r.definition }));
  return {
    date,
    cards: rows.map((c) => ({ ...publicCard(c, date), deckId: c.deckId, deckTitle: info.get(c.deckId)?.title ?? "" })),
    pool: pool.slice(0, 400),
  };
}

export const ReviewInput = z.object({ grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) });

/** Note une définition (1 à revoir · 2 difficile · 3 bien · 4 facile) et calcule sa prochaine date. */
export async function reviewCard(db: DB, userId: string, cardId: string, raw: z.input<typeof ReviewInput>) {
  const { grade } = ReviewInput.parse(raw);
  const { date } = await today(db, userId);
  const c = await loadCard(db, userId, cardId);
  const now = new Date();
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
