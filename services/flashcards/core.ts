/**
 * Cœur du vocabulaire, sans accès à la base : langues, lecture d'un lexique collé,
 * vérification des réponses écrites et répétition espacée des cartes.
 */

export type LangCode = "en" | "es" | "de" | "it" | "pt" | "nl" | "zh" | "ja" | "ar" | "ru" | "la";

/** Langues reconnues : nom affiché, voix de lecture (synthèse vocale du navigateur), mots qui les désignent. */
export const LANGS: Record<LangCode, { label: string; voice: string; flag: string; words: RegExp }> = {
  en: { label: "Anglais", voice: "en-GB", flag: "🇬🇧", words: /\b(anglais|english|ang|lva?\s*ang)\b/ },
  es: { label: "Espagnol", voice: "es-ES", flag: "🇪🇸", words: /\b(espagnol|espanol|spanish|esp|castillan)\b/ },
  de: { label: "Allemand", voice: "de-DE", flag: "🇩🇪", words: /\b(allemand|deutsch|german|all)\b/ },
  it: { label: "Italien", voice: "it-IT", flag: "🇮🇹", words: /\b(italien|italiano|italian|ita)\b/ },
  pt: { label: "Portugais", voice: "pt-PT", flag: "🇵🇹", words: /\b(portugais|portugues|portuguese)\b/ },
  nl: { label: "Néerlandais", voice: "nl-NL", flag: "🇳🇱", words: /\b(neerlandais|nederlands|dutch)\b/ },
  zh: { label: "Chinois", voice: "zh-CN", flag: "🇨🇳", words: /\b(chinois|chinese|mandarin)\b/ },
  ja: { label: "Japonais", voice: "ja-JP", flag: "🇯🇵", words: /\b(japonais|japanese)\b/ },
  ar: { label: "Arabe", voice: "ar-SA", flag: "🇸🇦", words: /\b(arabe|arabic)\b/ },
  ru: { label: "Russe", voice: "ru-RU", flag: "🇷🇺", words: /\b(russe|russian)\b/ },
  la: { label: "Latin", voice: "it-IT", flag: "🏛️", words: /\b(latin)\b/ },
};
export const LANG_CODES = Object.keys(LANGS) as LangCode[];
export const isLang = (v: unknown): v is LangCode => typeof v === "string" && v in LANGS;

const flat = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Langue vivante désignée par un nom de matière, de dossier ou de fichier (« LVA Espagnol », « Etudes/Anglais »). */
export function langOf(...names: (string | null | undefined)[]): LangCode | null {
  for (const n of names) {
    if (!n) continue;
    const f = flat(n).replace(/[^a-z0-9]+/g, " ");
    for (const code of LANG_CODES) if (LANGS[code].words.test(f)) return code;
  }
  return null;
}

/* ---------------------------------------------------------------- lexique collé ou saisi */

export type CardDraft = { term: string; translation: string; example?: string | null; exampleFr?: string | null; note?: string | null; kind?: string | null };

const SEPARATORS = [/\t+/, /\s+=\s*/, /\s*→\s*/, /\s*->\s*/, /\s+:\s+/, /\s+[–—-]\s+/, /\s*;\s*/];

/**
 * Lit un lexique « mot = traduction » (une paire par ligne ; séparateurs acceptés : =, →, ->, :, tiret, tabulation, point-virgule).
 * Renvoie `null` si le texte ne ressemble pas à une liste de paires (il sera alors confié à l'IA).
 */
export function parseLexicon(text: string): CardDraft[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const out: CardDraft[] = [];
  for (const line of lines) {
    let pair: [string, string] | null = null;
    for (const sep of SEPARATORS) {
      const m = line.split(sep);
      if (m.length === 2 && m[0].trim() && m[1].trim()) {
        pair = [m[0].trim(), m[1].trim()];
        break;
      }
    }
    if (pair) out.push({ term: pair[0].slice(0, 200), translation: pair[1].slice(0, 200) });
  }
  // Au moins les trois quarts des lignes doivent être des paires, sinon c'est un texte à analyser.
  return out.length && out.length >= Math.ceil(lines.length * 0.75) ? out : null;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Nettoie les cartes (IA ou saisie) : champs bornés, doublons écartés. */
export function sanitizeCards(raw: CardDraft[], max = 120): CardDraft[] {
  const seen = new Set<string>();
  const out: CardDraft[] = [];
  for (const r of raw) {
    const term = str(r.term, 200);
    const translation = str(r.translation, 200);
    if (!term || !translation) continue;
    const key = flat(term);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ term, translation, example: str(r.example, 300) || null, exampleFr: str(r.exampleFr, 300) || null, note: str(r.note, 200) || null, kind: str(r.kind, 20) || null });
    if (out.length >= max) break;
  }
  return out;
}

/* ---------------------------------------------------------------- réponse écrite */

const ARTICLES =
  /^(the|a|an|to|el|la|los|las|un|una|unos|unas|lo|der|die|das|den|dem|des|ein|eine|einen|einem|einer|il|lo|gli|i|le|l|un|uno|una|o|os|as|um|uma|de|het|een|le|la|les|l|un|une|des|du|se|s)\s+/;

/** Minuscules, ponctuation retirée ; `strip` retire aussi les accents. */
function clean(s: string, strip: boolean) {
  let t = s.toLowerCase().replace(/[’']/g, "'").replace(/[¡¿!?.,;:"«»()[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (strip) t = flat(t).replace(/ß/g, "ss");
  // Les articles et « to » devant un verbe anglais sont facultatifs : « (to) run », « el perro ».
  for (let i = 0; i < 2; i++) t = t.replace(ARTICLES, "");
  return t.replace(/'/g, "").trim();
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

/** Variantes acceptées d'une réponse : « correr, huir », « (to) run / to jog », parenthèses facultatives. */
export function variants(expected: string) {
  let parts = expected.split(/\s*[/;|]\s*|\s+ou\s+|\s+or\s+/).filter(Boolean);
  // La virgule sépare des synonymes (« correr, huir »), pas les morceaux d'une phrase (« Hola, ¿qué tal? »).
  const byComma = parts.flatMap((p) => p.split(/\s*,\s*/)).filter(Boolean);
  if (byComma.length > parts.length && byComma.every((p) => p.split(/\s+/).length <= 2 && !/[?¿!¡]/.test(p))) parts = byComma;
  const out = new Set<string>([expected]);
  for (const p of parts) {
    out.add(p);
    out.add(p.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim());
    out.add(p.replace(/[()]/g, ""));
  }
  return [...out].filter(Boolean);
}

export type Check = "exact" | "accents" | "typo" | "wrong";

/**
 * Compare une réponse écrite à la réponse attendue.
 * exact : juste ; accents : juste aux accents près ; typo : une petite faute de frappe ; wrong : faux.
 */
export function checkAnswer(given: string, expected: string): Check {
  if (!given.trim()) return "wrong";
  let best: Check = "wrong";
  for (const v of variants(expected)) {
    if (clean(given, false) === clean(v, false)) return "exact";
    const g = clean(given, true);
    const e = clean(v, true);
    if (!g || !e) continue;
    if (g === e) best = "accents";
    else if (best === "wrong" && e.length > 4 && distance(g, e) <= (e.length <= 9 ? 1 : 2)) best = "typo";
  }
  return best;
}

/* ---------------------------------------------------------------- répétition espacée */

/** 1 = à revoir, 2 = difficile, 3 = bien, 4 = facile. */
export type Grade = 1 | 2 | 3 | 4;
export type SrsState = { state: string; interval: number; ease: number; reps: number; lapses: number };

/**
 * Répétition espacée inspirée de SM-2 : une carte sue revient de plus en plus tard (1 j, 3 j, puis ×2,5…),
 * une carte ratée revient le jour même puis le lendemain.
 */
export function schedule(s: SrsState, grade: Grade): SrsState {
  if (grade === 1) return { state: "learning", interval: 0, ease: Math.max(130, s.ease - 20), reps: 0, lapses: s.lapses + (s.state === "new" ? 0 : 1) };
  const ease = Math.min(320, Math.max(130, s.ease + (grade === 2 ? -15 : grade === 4 ? 15 : 0)));
  let interval: number;
  if (s.reps === 0) interval = grade === 2 ? 1 : grade === 3 ? 1 : 4;
  else if (s.reps === 1) interval = grade === 2 ? 2 : grade === 3 ? 3 : 6;
  else interval = Math.round(Math.max(s.interval, 1) * (grade === 2 ? 1.2 : grade === 3 ? ease / 100 : (ease / 100) * 1.3));
  interval = Math.min(365, Math.max(1, interval));
  return { state: "review", interval, ease, reps: s.reps + 1, lapses: s.lapses };
}

/** Délai affiché sous chaque bouton (« 3 j », « 2 mois »). */
export function intervalLabel(days: number) {
  if (days <= 0) return "aujourd'hui";
  if (days < 30) return `${days} j`;
  if (days < 365) return `${Math.round(days / 30)} mois`;
  return "1 an";
}

/** Une carte est « sue » quand elle revient dans trois semaines ou plus. */
export const MASTERED = 21;
