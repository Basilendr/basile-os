/**
 * Cœur des définitions, sans accès à la base : lecture d'une liste collée, mots importants
 * (calcul local, en secours de l'IA), correction d'une définition écrite et surlignage.
 */

export type DefDraft = { term: string; definition: string; keywords?: string[] | null };

/** Minuscules sans accents, apostrophes unifiées. */
export const flat = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'");

/* ---------------------------------------------------------------- liste collée */

// « Notion : définition », « Notion = définition », « Notion → définition », « Notion – définition », tabulation.
const SEPARATORS = [/\t+/, /\s*:\s+/, /\s+=\s*/, /\s*→\s*/, /\s*->\s*/, /\s+[–—]\s+/, /\s+-\s+/];

/** Coupe une ligne « notion : définition » ; la notion doit rester courte (12 mots au plus). */
function splitLine(line: string): [string, string] | null {
  // Le premier séparateur de la ligne : la définition peut elle-même contenir « : » ou « - ».
  let best: RegExpExecArray | null = null;
  for (const sep of SEPARATORS) {
    const m = sep.exec(line);
    if (m && m.index > 0 && (!best || m.index < best.index)) best = m;
  }
  if (!best) return null;
  const term = line.slice(0, best.index).trim();
  const def = line.slice(best.index + best[0].length).trim();
  // Une notion est courte et n'est pas une phrase.
  return term && def && term.split(/\s+/).length <= 8 && term.length <= 90 && !/[.!?]/.test(term) ? [term, def] : null;
}

/**
 * Lit une liste de définitions (une par ligne, « notion : définition »). Une ligne sans séparateur
 * prolonge la définition précédente. Renvoie `null` si le texte ne ressemble pas à une liste (il sera confié à l'IA).
 */
export function parseDefinitions(text: string): DefDraft[] | null {
  const lines = text
    .replace(/\u000b/g, "\n")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•·♥]|\d+[.)])\s*/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const out: DefDraft[] = [];
  let orphans = 0;
  for (const line of lines) {
    const pair = splitLine(line);
    if (pair) out.push({ term: pair[0], definition: pair[1] });
    else if (out.length) out[out.length - 1].definition += ` ${line}`;
    else orphans++;
  }
  // Une vraie liste : surtout des lignes « notion : définition ».
  const pairs = out.length;
  return pairs && pairs >= Math.ceil((lines.length - orphans) * 0.5) && orphans <= Math.max(1, lines.length * 0.2) ? out : null;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Nettoie les définitions (IA ou saisie) : champs bornés, doublons écartés, mots clés vérifiés. */
export function sanitizeDefs(raw: DefDraft[], max = 200): DefDraft[] {
  const seen = new Set<string>();
  const out: DefDraft[] = [];
  for (const r of raw) {
    const term = str(r.term, 200).replace(/\s*:$/, "");
    const definition = str(r.definition, 1500);
    if (!term || !definition) continue;
    const key = flat(term);
    if (seen.has(key)) continue;
    seen.add(key);
    const keywords = r.keywords?.length ? cleanKeywords(r.keywords, definition) : null;
    out.push({ term, definition, keywords: keywords?.length ? keywords : null });
    if (out.length >= max) break;
  }
  return out;
}

/* ---------------------------------------------------------------- mots importants */

const STOP = new Set(
  (
    "a au aux avec ce ces cet cette ci comme dans de des du elle elles en entre est et etre eux il ils je la le les leur leurs lui ma mais me meme mes moi mon ne ni nos notre nous on ou par pas plus pour qu que qui sa sans se ses si son sont sur ta te tes toi ton tu un une vos votre vous y " +
    "l d s n c j m t qu' alors aussi autre autres avoir bien car celle celui cela chaque chez donc dont deja elle-meme ensemble etc fait faire fois font peut peuvent plusieurs souvent tous tout toute toutes tres " +
    "certain certains certaine certaines ainsi afin selon lors depuis quand quel quelle quels quelles sous vers parfois surtout notamment davantage moins tant ceux celles generalement"
  ).split(/\s+/),
);

/** Mots d'un texte, sans accents, avec leur position dans le texte d'origine. */
export function words(s: string) {
  const out: { w: string; raw: string; start: number; end: number }[] = [];
  const re = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
  for (let m = re.exec(s); m; m = re.exec(s)) out.push({ w: flat(m[0]).replace(/^(?:l|d|s|n|c|j|m|t|qu)'/, ""), raw: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

const significant = (w: string) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w);
/** Mots trop généraux pour être choisis seuls comme mots clés (mais acceptés si l'IA ou l'élève les choisit). */
const WEAK = new Set("ensemble personne personnes chose choses forme formes fait faits maniere facon partie type types".split(" "));

/** Racine approximative d'un mot français (« solidarités » ≈ « solidarite », « ressources » ≈ « ressource »). */
export function stem(w: string) {
  let s = w.replace(/(?:ements?|ations?|issements?|euses?|eurs?|ives?|iques?|elles?|ales?|antes?|ants?|aux|ees?|es|s|x|e)$/u, "");
  if (s.length < 4) s = w.slice(0, Math.max(4, Math.min(w.length, 5)));
  return s;
}

/** Garde les mots clés présents dans la définition, dans l'ordre, sans doublon. */
export function cleanKeywords(raw: string[], definition: string) {
  const d = flat(definition);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    const kw = str(k, 80).replace(/^[«"“(]+|[»"”).,;:]+$/g, "").trim();
    const f = flat(kw);
    if (!kw || seen.has(f) || !d.includes(f)) continue;
    if (!words(kw).some((x) => significant(x.w))) continue;
    seen.add(f);
    out.push(kw);
  }
  return out.sort((a, b) => d.indexOf(flat(a)) - d.indexOf(flat(b))).slice(0, 6);
}

/**
 * Mots importants sans IA : les mots porteurs de sens de la définition (pas les mots-outils
 * ni ceux de la notion elle-même), les plus longs d'abord, remis dans l'ordre du texte.
 */
export function autoKeywords(term: string, definition: string, max?: number) {
  const inTerm = new Set(words(term).map((x) => stem(x.w)));
  const ws = words(definition).filter((x) => significant(x.w) && !WEAK.has(x.w) && !inTerm.has(stem(x.w)));
  const seen = new Set<string>();
  const uniq = ws.filter((x) => (seen.has(stem(x.w)) ? false : (seen.add(stem(x.w)), true)));
  const n = max ?? Math.min(5, Math.max(2, Math.round(uniq.length / 2.5)));
  return uniq
    .map((x, i) => ({ ...x, i, score: x.w.length + (x.raw[0] === x.raw[0].toUpperCase() && i > 0 ? 3 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.raw.replace(/^(?:l|d|s|n|c|j|m|t|qu)['’]/i, ""));
}

/* ---------------------------------------------------------------- réponse écrite */

function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Un mot de la réponse correspond-il au mot attendu (accents, pluriel, petite faute acceptés) ? */
function sameWord(given: string, expected: string) {
  if (given === expected) return true;
  if (stem(given) === stem(expected)) return true;
  const se = stem(expected);
  if (se.length >= 5 && given.startsWith(se)) return true;
  // Même famille de mots (« rattache » / « rattachant », « mobilise » / « mobilisables »).
  let p = 0;
  while (p < given.length && p < expected.length && given[p] === expected[p]) p++;
  if (p >= 6 && p >= Math.min(given.length, expected.length) * 0.75) return true;
  return expected.length >= 6 && Math.abs(given.length - expected.length) <= 2 && distance(given, expected) <= (expected.length >= 10 ? 2 : 1);
}

export type DefCheck = { found: string[]; missing: string[]; score: number; grade: 1 | 2 | 3 };

/**
 * Corrige une définition écrite : chaque mot clé compte s'il apparaît dans la réponse
 * (tous ses mots porteurs de sens, accents et accords ignorés).
 * Note : 3 (bien) dès 75 % des mots clés, 2 (difficile) dès 40 %, sinon 1 (raté).
 */
export function checkDefinition(given: string, keywords: string[], definition = ""): DefCheck {
  const g = words(given).map((x) => x.w);
  const keys = keywords.length ? keywords : autoKeywords("", definition, 4);
  const found: string[] = [];
  const missing: string[] = [];
  for (const k of keys) {
    const parts = words(k).map((x) => x.w);
    const need = parts.filter(significant);
    const list = need.length ? need : parts;
    const ok = list.length > 0 && list.every((p) => g.some((w) => sameWord(w, p)));
    (ok ? found : missing).push(k);
  }
  const score = keys.length ? found.length / keys.length : 0;
  return { found, missing, score, grade: score >= 0.75 ? 3 : score >= 0.4 ? 2 : 1 };
}

/* ---------------------------------------------------------------- surlignage */

export type Segment = { text: string; key?: string };

/** Découpe la définition en morceaux, en repérant les mots clés (accents et majuscules ignorés). */
export function highlight(definition: string, keywords: string[]): Segment[] {
  // Texte aplati caractère par caractère, avec la position d'origine de chaque caractère.
  let f = "";
  const map: number[] = [];
  for (let i = 0; i < definition.length; i++) {
    const c = flat(definition[i]);
    for (const ch of c) {
      f += ch;
      map.push(i);
    }
  }
  const ranges: { s: number; e: number; key: string }[] = [];
  for (const k of [...keywords].sort((a, b) => b.length - a.length)) {
    const fk = flat(k);
    if (!fk) continue;
    let from = 0;
    for (let at = f.indexOf(fk, from); at >= 0; at = f.indexOf(fk, from)) {
      const s = map[at];
      const e = map[at + fk.length - 1] + 1;
      from = at + fk.length;
      // Mot entier seulement, et pas déjà couvert par un mot clé plus long.
      const before = definition[s - 1];
      const after = definition[e];
      if ((before && /[\p{L}\p{N}]/u.test(before)) || (after && /[\p{L}\p{N}]/u.test(after))) continue;
      if (ranges.some((r) => s < r.e && e > r.s)) continue;
      ranges.push({ s, e, key: k });
      break;
    }
  }
  ranges.sort((a, b) => a.s - b.s);
  const out: Segment[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.s > pos) out.push({ text: definition.slice(pos, r.s) });
    out.push({ text: definition.slice(r.s, r.e), key: r.key });
    pos = r.e;
  }
  if (pos < definition.length) out.push({ text: definition.slice(pos) });
  return out;
}
