import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError, type ZodType } from "zod";
import { AppError } from "./errors";
import { currentUser, type SessionUser } from "./auth";
import { getDb, type DB } from "./db";
import { log } from "./log";
import { rateLimit } from "./rate-limit";

type Ctx<B, Q> = {
  req: NextRequest;
  user: SessionUser;
  db: DB;
  body: B;
  query: Q;
  params: Record<string, string>;
};

type Opts<B, Q> = {
  auth?: boolean;
  body?: ZodType<B>;
  query?: ZodType<Q>;
  /** [nombre de requêtes, fenêtre en ms] par utilisateur */
  rate?: [number, number];
};

/**
 * Enveloppe commune des routes API :
 * authentification, protection CSRF (vérification d'origine), validation Zod,
 * limitation de débit et gestion centralisée des erreurs.
 */
export function route<B = undefined, Q = undefined>(
  opts: Opts<B, Q>,
  fn: (ctx: Ctx<B, Q>) => Promise<unknown>,
) {
  return async (req: NextRequest, segment?: { params?: Promise<Record<string, string>> }) => {
    const started = Date.now();
    try {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      const user = opts.auth === false ? (null as unknown as SessionUser) : await currentUser();
      if (opts.auth !== false && !user) throw new AppError("unauthorized", "Session expirée, reconnecte-toi.");
      if (opts.rate) rateLimit(`${user?.id ?? ip(req)}:${req.nextUrl.pathname}`, ...opts.rate);
      const params = (await segment?.params) ?? {};
      const query = opts.query
        ? opts.query.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))
        : (undefined as Q);
      let body = undefined as B;
      if (opts.body) {
        const json = await req.json().catch(() => {
          throw new AppError("bad_request", "Corps JSON invalide");
        });
        body = opts.body.parse(json);
      }
      const db = await getDb();
      const result = await fn({ req, user: user as SessionUser, db, body, query, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e, req, started);
    }
  };
}

export function errorResponse(e: unknown, req: NextRequest, started = Date.now()) {
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Données invalides", issues: z.flattenError(e).fieldErrors } },
      { status: 400 },
    );
  }
  if (e instanceof AppError) {
    if (e.status >= 500) log.error("api.error", { path: req.nextUrl.pathname, code: e.code, message: e.message });
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  log.error("api.unhandled", {
    path: req.nextUrl.pathname,
    method: req.method,
    ms: Date.now() - started,
    error: e instanceof Error ? (e.stack ?? e.message).split("\n").slice(0, 4).join("\n") : String(e),
    cause: e instanceof Error && e.cause ? String(e.cause) : undefined,
  });
  return NextResponse.json({ error: { code: "internal", message: "Erreur interne du serveur" } }, { status: 500 });
}

function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new AppError("forbidden", "Requête inter-sites refusée");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    throw new AppError("forbidden", "Origine non autorisée");
  }
}

// Derrière le tunnel Cloudflare, cf-connecting-ip est fixé par Cloudflare (x-forwarded-for peut être falsifié).
const ip = (req: NextRequest) => req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "local";

/* Schémas réutilisables */
export const zId = z.uuid();
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue AAAA-MM-JJ");
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure attendue HH:mm");
export const zPriority = z.enum(["low", "medium", "high", "urgent"]);
