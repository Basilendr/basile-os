import { createHash } from "node:crypto";
import type { QuizQuestion } from "@/database/schema";

/**
 * Cœur des quiz, sans accès à la base : nettoyage des questions produites par l'IA,
 * correction des réponses et répétition espacée.
 */

/** Répétition espacée (boîtes de Leitner) : jours avant de revoir une question selon sa boîte. */
export const INTERVALS = [1, 3, 7, 14, 30];

export type RawQuestion = {
  type?: string | null;
  prompt?: string | null;
  choices?: (string | null)[] | null;
  answerIndex?: number | null;
  answerBool?: boolean | null;
  answer?: string | null;
  accepted?: (string | null)[] | null;
  explanation?: string | null;
  subject?: string | null;
  topic?: string | null;
  source?: string | null;
  difficulty?: number | null;
};

const ARTICLES = /\b(le|la|les|l|un|une|des|du|de|d|the|an|el|los|las)\b/g;

function flat(s: string) {
  return s
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Réponse ramenée à l'essentiel : minuscules, sans accents, ponctuation ni articles. */
export function normalize(s: string) {
  const f = flat(s);
  return f.replace(ARTICLES, " ").replace(/\s+/g, " ").trim() || f;
}

function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Réponse identique à une faute de frappe près (les dates et les nombres doivent être exacts). */
export function closeEnough(given: string, expected: string) {
  const g = normalize(given);
  const e = normalize(expected);
  if (!g || !e) return false;
  if (g === e) return true;
  if (/\d/.test(e)) return false;
  return distance(g, e) <= (e.length <= 4 ? 0 : e.length <= 9 ? 1 : 2);
}

export function matchOpen(q: Pick<QuizQuestion, "answer" | "accepted">, value: string) {
  return [q.answer ?? "", ...(q.accepted ?? [])].some((a) => closeEnough(value, a));
}

/** Corrige une réponse sans IA. `null` : réponse ouverte à faire juger par l'IA. */
export function grade(q: QuizQuestion, value: string): boolean | null {
  if (q.type === "mcq") return value !== "" && Number(value) === q.answerIndex;
  if (q.type === "tf") return (value === "true" || value === "false") && (value === "true") === q.answerBool;
  if (!value.trim()) return false;
  return matchOpen(q, value) ? true : null;
}

/** Identité d'une question pour la répétition espacée. */
export function cardKey(prompt: string) {
  return createHash("sha1").update(normalize(prompt)).digest("hex");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function shuffle<T>(a: T[], rand: () => number) {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Valide les questions de l'IA, écarte celles qui sont inutilisables et mélange les propositions des QCM. */
export function sanitizeQuestions(raw: RawQuestion[], count: number, rand: () => number = Math.random): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (out.length >= count) break;
    const prompt = str(r.prompt, 600);
    const key = normalize(prompt);
    if (prompt.length < 8 || seen.has(key)) continue;
    const base = {
      id: `q${out.length + 1}`,
      prompt,
      explanation: str(r.explanation, 900),
      subject: str(r.subject, 60) || "Général",
      topic: str(r.topic, 80),
      source: str(r.source, 300) || undefined,
      difficulty: Math.min(3, Math.max(1, Math.round(Number(r.difficulty) || 2))),
    };
    if (r.type === "mcq") {
      const idx = Number(r.answerIndex);
      const all = (r.choices ?? []).map((c) => str(c, 240));
      if (!Number.isInteger(idx) || !all[idx]) continue;
      const right = all[idx];
      const wrong = [...new Set(all.filter((c, i) => c && i !== idx && normalize(c) !== normalize(right)))].slice(0, 3);
      if (wrong.length < 2) continue;
      const choices = shuffle([right, ...wrong], rand);
      out.push({ ...base, type: "mcq", choices, answerIndex: choices.indexOf(right) });
    } else if (r.type === "tf") {
      if (typeof r.answerBool !== "boolean") continue;
      out.push({ ...base, type: "tf", answerBool: r.answerBool });
    } else if (r.type === "open") {
      const answer = str(r.answer, 200);
      if (!answer) continue;
      out.push({ ...base, type: "open", answer, accepted: (r.accepted ?? []).map((a) => str(a, 200)).filter(Boolean).slice(0, 8) });
    } else continue;
    seen.add(key);
  }
  return out;
}

/** Ce qui est dévoilé une fois la question répondue. */
export function reveal(q: QuizQuestion) {
  return { answerIndex: q.answerIndex, answerBool: q.answerBool, answer: q.answer, explanation: q.explanation, source: q.source };
}

/** Bonne réponse en toutes lettres. */
export function answerText(q: QuizQuestion) {
  return q.type === "mcq" ? (q.choices?.[q.answerIndex ?? 0] ?? "") : q.type === "tf" ? (q.answerBool ? "Vrai" : "Faux") : (q.answer ?? "");
}
