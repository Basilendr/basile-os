import "server-only";
import path from "node:path";
import fs from "node:fs";
import * as schema from "@/database/schema";
import { env } from "./env";
import { log } from "./log";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = path.resolve(process.cwd(), "database/migrations");
const EXTENSIONS = ["vector", "pg_trgm", "unaccent"];

type Holder = { promise?: Promise<DB> };
const g = globalThis as unknown as { __basileDb?: Holder };
const holder: Holder = (g.__basileDb ??= {});

/**
 * Connexion unique à PostgreSQL :
 *  - DATABASE_URL défini → serveur PostgreSQL (Supabase, Neon, self-hosted) via postgres-js ;
 *  - sinon → PostgreSQL embarqué (PGlite, WASM) persistant dans DATA_DIR/pg.
 * Les migrations versionnées (database/migrations) sont appliquées au démarrage.
 */
export function getDb(): Promise<DB> {
  const p = (holder.promise ??= connect().then(async (db) => (await loadSecrets(db), (secretsLoadedAt = Date.now()), db)).catch((e) => {
    holder.promise = undefined;
    throw e;
  }));
  // Sur Vercel, plusieurs instances tournent en parallèle : un secret enregistré sur l'une
  // doit être vu par les autres. On relit donc la table des secrets toutes les quelques secondes.
  if (env.VERCEL) return p.then(refreshSecrets);
  return p;
}

let secretsLoadedAt = 0;
let refreshing: Promise<void> | undefined;
async function refreshSecrets(db: DB): Promise<DB> {
  if (Date.now() - secretsLoadedAt > 5_000) {
    refreshing ??= loadSecrets(db)
      .then(() => void (secretsLoadedAt = Date.now()))
      .catch((e) => log.warn("secrets.refresh_failed", { error: String(e) }))
      .finally(() => (refreshing = undefined));
    await refreshing;
  }
  return db;
}

async function connect(): Promise<DB> {
  if (env.DATABASE_URL) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    // Migrations sur une connexion dédiée (hors pooler), sous verrou consultatif :
    // sur Vercel plusieurs instances démarrent en même temps et migreraient en parallèle.
    const admin = postgres(process.env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await admin`select pg_advisory_lock(727274001)`;
      for (const ext of EXTENSIONS) await admin.unsafe(`create extension if not exists ${ext}`);
      await migrate(drizzle(admin, { schema }), { migrationsFolder: MIGRATIONS });
    } finally {
      await admin`select pg_advisory_unlock(727274001)`.catch(() => {});
      await admin.end({ timeout: 5 });
    }
    const client = postgres(env.DATABASE_URL, { max: env.VERCEL ? 3 : 10, prepare: false, idle_timeout: env.VERCEL ? 20 : undefined });
    const db = drizzle(client, { schema });
    log.info("db.connected", { driver: "postgres" });
    return db as unknown as DB;
  }
  return createEmbeddedDb(path.resolve(env.DATA_DIR, "pg"));
}

/** Base PGlite — `dir` vide = base en mémoire (tests). */
export async function createEmbeddedDb(dir?: string): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const { unaccent } = await import("@electric-sql/pglite/contrib/unaccent");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const client = await PGlite.create({ dataDir: dir, extensions: { vector, pg_trgm, unaccent } });
  await client.exec(EXTENSIONS.map((e) => `create extension if not exists ${e};`).join("\n"));
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  if (dir) log.info("db.connected", { driver: "pglite", dir });
  return db as unknown as DB;
}

export { schema };

/** Charge en mémoire les secrets saisis dans l'interface (déchiffrés). */
async function loadSecrets(db: DB) {
  const { decrypt } = await import("./crypto");
  const { setCachedSecret, SECRET_NAMES } = await import("./secrets");
  const rows = await db.select().from(schema.instanceSecrets);
  // Un secret supprimé ailleurs doit aussi disparaître du cache.
  const present = new Set(rows.map((r) => r.name));
  for (const n of SECRET_NAMES) if (!present.has(n)) setCachedSecret(n, null);
  for (const r of rows) {
    if (!(SECRET_NAMES as readonly string[]).includes(r.name)) continue;
    try {
      setCachedSecret(r.name as (typeof SECRET_NAMES)[number], decrypt(r.valueEnc));
    } catch {
      log.warn("secrets.decrypt_failed", { name: r.name });
    }
  }
}
