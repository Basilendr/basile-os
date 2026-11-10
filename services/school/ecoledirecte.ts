import "server-only";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";

/**
 * Client de l'API École Directe (non officielle, documentée par la communauté :
 * github.com/EduWireApps/ecoledirecte-api-docs). Toutes les requêtes sont des POST
 * avec un paramètre `verbe` et un corps `data=<JSON>` ; le jeton change à chaque réponse.
 */
export const ED_BASE = "https://api.ecoledirecte.com";
/** Version de l'application web envoyée à chaque requête (une version trop ancienne est refusée : code 517). */
export const ED_VERSION = process.env.ED_API_VERSION || "4.104.3";
/** Le jeton est lié à l'agent utilisateur : on en utilise toujours un seul. */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

export type EdResponse<T = unknown> = { code: number; token?: string; message?: string; data: T; host?: string };
/** État de session reproduit depuis l'application web : jeton, GTK, cookies et jeton de double authentification. */
export type Session = { token: string; gtk: string; cookie: string; twoFa?: string };
export type Factor = { cn: string; cv: string; uniq?: boolean };

export class EdError extends AppError {
  constructor(
    public edCode: number,
    message: string,
  ) {
    // Identifiants refusés : surtout pas « unauthorized », qui déconnecterait l'utilisateur de BASILE OS.
    super(edCode === 505 || edCode === 520 || edCode === 525 ? "invalid_credentials" : "integration_error", message, { edCode });
  }
}

const decode64 = (s: string | null | undefined) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

/* ------------------------------------------------------------------ cookies et en-têtes */

function jar(cookie: string) {
  const m = new Map<string, string>();
  for (const part of cookie.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) m.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return m;
}
const serialize = (m: Map<string, string>) => [...m].map(([k, v]) => `${k}=${v}`).join("; ");

/** Met à jour la session avec les en-têtes renvoyés (jeton, GTK, 2FA-Token, cookies). */
function absorb(session: Session, res: Response): Session {
  const m = jar(session.cookie);
  const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  for (const c of set) {
    const first = c.split(";")[0];
    const i = first.indexOf("=");
    if (i > 0) m.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
  return {
    token: res.headers.get("x-token") || session.token,
    gtk: res.headers.get("x-gtk") || m.get("GTK") || session.gtk,
    cookie: serialize(m),
    twoFa: res.headers.get("2fa-token") || session.twoFa,
  };
}

function headersFor(session: Partial<Session> | undefined, withGtk: boolean) {
  const h: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", "user-agent": UA, accept: "application/json, text/plain, */*" };
  if (session?.cookie) h.cookie = session.cookie;
  if (withGtk && session?.gtk) h["x-gtk"] = session.gtk;
  if (session?.token) h["x-token"] = session.token;
  if (session?.twoFa) h["2fa-token"] = session.twoFa;
  return h;
}

/** Corps identique à celui du site officiel : `data=<JSON>` non encodé, seuls %, & et + sont échappés dans les chaînes. */
export function edBody(data: unknown) {
  const json = JSON.stringify(data ?? {}, (_k, v) => (typeof v === "string" ? v.replaceAll("%", "%25").replaceAll("&", "%26").replaceAll("+", "%2B") : v));
  return `data=${json}`;
}

export async function edRequest<T>(path: string, o: { verbe?: string; query?: Record<string, string>; data?: unknown; session?: Partial<Session>; withGtk?: boolean } = {}): Promise<EdResponse<T> & { session: Session }> {
  const q = new URLSearchParams({ ...(o.verbe ? { verbe: o.verbe } : {}), ...(o.query ?? {}), v: ED_VERSION });
  let res: Response;
  try {
    res = await fetch(`${ED_BASE}${path}?${q}`, { method: "POST", headers: headersFor(o.session, o.withGtk ?? true), body: edBody(o.data), signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new AppError("integration_error", `École Directe injoignable : ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: EdResponse<T>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AppError("integration_error", `Réponse inattendue d'École Directe (HTTP ${res.status}).`);
  }
  const session = absorb({ token: o.session?.token ?? "", gtk: o.session?.gtk ?? "", cookie: o.session?.cookie ?? "", twoFa: o.session?.twoFa }, res);
  if (json.token) session.token = json.token;
  return { ...json, session };
}

/** Télécharge une pièce jointe de la messagerie. Renvoie le fichier, ou le code d'erreur d'École Directe. */
export async function edDownload(fileId: number, session: Partial<Session>, year?: string): Promise<{ code: number; message?: string; data: Buffer | null; mimeType: string; session: Session }> {
  const q = new URLSearchParams({ verbe: "get", fichierId: String(fileId), leTypeDeFichier: "PIECE_JOINTE", ...(year ? { anneeMessages: year } : {}), v: ED_VERSION });
  let res: Response;
  try {
    res = await fetch(`${ED_BASE}/v3/telechargement.awp?${q}`, { method: "POST", headers: headersFor(session, true), body: edBody({ forceDownload: 0 }), signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new AppError("integration_error", `École Directe injoignable : ${(e as Error).message}`);
  }
  const next = absorb({ token: session.token ?? "", gtk: session.gtk ?? "", cookie: session.cookie ?? "", twoFa: session.twoFa }, res);
  const mimeType = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
  const data = Buffer.from(await res.arrayBuffer());
  // Une erreur (jeton expiré…) revient en JSON à la place du fichier.
  if (mimeType.includes("json") || (data.length < 2000 && data.subarray(0, 1).toString() === "{")) {
    try {
      const j = JSON.parse(data.toString("utf8")) as EdResponse;
      if (j.token) next.token = j.token;
      return { code: j.code ?? 500, message: j.message, data: null, mimeType, session: next };
    } catch {}
  }
  return { code: res.ok ? 200 : res.status, data: res.ok ? data : null, mimeType, session: next };
}

/** Pré-étape obligatoire avant chaque connexion : un GTK neuf (cookie + en-tête X-GTK). */
export async function getGtk(prev?: Session): Promise<Session> {
  const base: Session = { token: prev?.token ?? "", gtk: "", cookie: prev?.cookie ?? "", twoFa: prev?.twoFa };
  const res = await fetch(`${ED_BASE}/v3/login.awp?gtk=1&v=${ED_VERSION}`, { headers: { "user-agent": UA, accept: "application/json, text/plain, */*", ...(base.cookie ? { cookie: base.cookie } : {}) }, signal: AbortSignal.timeout(15_000) }).catch((e) => {
    throw new AppError("integration_error", `École Directe injoignable : ${(e as Error).message}`);
  });
  const s = absorb(base, res);
  try {
    const body = JSON.parse(await res.text()) as { token?: string };
    if (!s.gtk && body.token) s.gtk = body.token;
  } catch {}
  if (!s.gtk) log.warn("ecoledirecte.gtk_missing");
  return s;
}

export type EdAccount = {
  id: number;
  typeCompte: string;
  prenom: string;
  nom: string;
  nomEtablissement?: string;
  anneeScolaireCourante?: string;
  profile?: { classe?: { libelle?: string }; nomEtablissement?: string; eleves?: { id: number; prenom: string; nom: string; nomEtablissement?: string; classe?: { libelle?: string } }[] };
};

export type LoginResult =
  | { kind: "ok"; session: Session; account: EdAccount }
  | { kind: "qcm"; session: Session; question: string; propositions: { raw: string; label: string }[] };

function loginError(code: number, message?: string) {
  log.warn("ecoledirecte.login_refused", { code, message: message?.slice(0, 160) });
  if (code === 505) return new EdError(code, "Identifiant ou mot de passe École Directe incorrect.");
  if (code === 517) return new EdError(code, "Version de l'API École Directe obsolète : mets à jour ED_API_VERSION.");
  if (code === 535) return new EdError(code, "Établissement indisponible sur École Directe pour le moment.");
  if (code === 516 || code === 74000) return new EdError(code, "École Directe demande d'accepter la charte : connecte-toi une fois sur ecoledirecte.com puis réessaie.");
  return new EdError(code, message ? `École Directe : ${message}` : `Erreur École Directe (code ${code}).`);
}

/**
 * Connexion telle que la fait l'application web : GTK neuf, POST login, puis question de sécurité
 * si demandée. `fa` contient les réponses déjà validées (réutilisables), `answered` la réponse
 * qui vient d'être donnée (envoyée aussi en clair dans cn / cv, comme le site officiel).
 */
export async function login(username: string, password: string, fa: Factor[] = [], o: { answered?: Factor; prev?: Session } = {}): Promise<LoginResult> {
  const boot = await getGtk(o.prev);
  const r = await edRequest<{ accounts: EdAccount[]; totp?: boolean }>("/v3/login.awp", {
    data: { identifiant: username, motdepasse: password, isReLogin: false, uuid: "", ...(o.answered ? { cn: o.answered.cn, cv: o.answered.cv } : {}), fa },
    session: boot,
  });
  if (r.code === 200 && r.data?.accounts?.length) return { kind: "ok", session: r.session, account: r.data.accounts[0] };
  if (r.code === 250) {
    if (r.data?.totp === true) throw new EdError(250, "Ton compte utilise un code de double authentification par application : désactive-le dans École Directe ou utilise la question de sécurité.");
    const q = await edRequest<{ question: string; propositions: string[] }>("/v3/connexion/doubleauth.awp", { verbe: "get", data: {}, session: r.session, withGtk: false });
    if (q.code !== 200 || !q.data?.propositions?.length) throw loginError(q.code, q.message || "Impossible d'obtenir la question de sécurité.");
    return { kind: "qcm", session: q.session, question: decode64(q.data.question), propositions: q.data.propositions.map((p) => ({ raw: p, label: decode64(p) })) };
  }
  // Des réponses mémorisées périmées font échouer la connexion : on réessaie sans elles.
  if (r.code === 505 && fa.length && !o.answered) return login(username, password, [], { prev: undefined });
  throw loginError(r.code, r.message);
}

/** Réponse au QCM de sécurité : renvoie cn/cv réutilisables et la session à poursuivre. */
export async function answerQcm(session: Session, choiceRaw: string): Promise<{ factor: Factor; session: Session }> {
  const r = await edRequest<{ cn: string; cv: string }>("/v3/connexion/doubleauth.awp", { verbe: "post", data: { choix: choiceRaw }, session, withGtk: false });
  if (r.code !== 200 || !r.data?.cn) throw new EdError(r.code === 505 ? 400 : r.code, r.message || "Réponse incorrecte à la question de sécurité.");
  return { factor: { cn: r.data.cn, cv: r.data.cv, uniq: false }, session: r.session };
}

/** Élève ciblé : le compte lui-même (élève) ou le premier enfant (compte famille). */
export function resolveStudent(a: EdAccount) {
  if (a.typeCompte === "E") return { studentId: a.id, studentName: `${a.prenom} ${a.nom}`.trim(), className: a.profile?.classe?.libelle ?? null, schoolName: a.nomEtablissement ?? a.profile?.nomEtablissement ?? null };
  const e = a.profile?.eleves?.[0];
  if (!e) throw new AppError("integration_error", "Aucun élève rattaché à ce compte École Directe.");
  return { studentId: e.id, studentName: `${e.prenom} ${e.nom}`.trim(), className: e.classe?.libelle ?? null, schoolName: e.nomEtablissement ?? a.nomEtablissement ?? null };
}

/* ------------------------------------------------------------------ données */

export type EdLesson = { id: number; text: string; matiere: string; codeMatiere: string; typeCours: string; start_date: string; end_date: string; color: string; prof: string; salle: string; isAnnule: boolean };
export type EdHomeworkDay = Record<string, { matiere: string; codeMatiere: string; idDevoir: number; donneLe: string; effectue: boolean; interrogation: boolean }[]>;
export type EdHomeworkDetail = { date: string; matieres: { matiere: string; codeMatiere: string; nomProf: string; id: number; interrogation: boolean; aFaire?: { idDevoir: number; contenu: string; donneLe: string; effectue: boolean } }[] };
export type EdGrade = { id: number; devoir: string; codePeriode: string; libelleMatiere: string; typeDevoir: string; commentaire: string; coef: string; noteSur: string; valeur: string; nonSignificatif: boolean; date: string; moyenneClasse: string };
export type EdMessage = { id: number; subject: string; date: string; read: boolean; from?: { name?: string; nom?: string; prenom?: string; civilite?: string } };

export const decodeContent = decode64;
