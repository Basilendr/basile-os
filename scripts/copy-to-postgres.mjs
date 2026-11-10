// Copie la base locale (PGlite, .data/pg) vers une base PostgreSQL en ligne (Neon…).
// Usage : DATABASE_URL=postgres://… node scripts/copy-to-postgres.mjs
// La base cible doit être vide ; les fichiers importés (.data/files) sont copiés dans file_blobs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Instantané de la base locale : on ne lit jamais le dossier qu'utilise le serveur en marche.
const snap = fs.mkdtempSync(path.join(os.tmpdir(), "basile-pg-"));
fs.cpSync(path.join(root, ".data/pg"), snap, { recursive: true });
const src = await PGlite.create({ dataDir: snap, extensions: { vector, pg_trgm, unaccent } });
const dst = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

for (const ext of ["vector", "pg_trgm", "unaccent"]) await dst.unsafe(`create extension if not exists ${ext}`);
await migrate(drizzle(dst), { migrationsFolder: path.join(root, "database/migrations") });

const [{ n }] = await dst`select count(*)::int as n from users`;
if (n > 0) throw new Error("La base en ligne contient déjà des comptes : copie annulée pour ne rien écraser.");

const tables = (await src.query(`select table_name as t from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`)).rows.map((r) => r.t);
const fks = (
  await src.query(`select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace where c.contype='f' and n.nspname='public'`)
).rows.map((r) => ({ child: r.child.replace(/"/g, ""), parent: r.parent.replace(/"/g, "") }));

// Ordre : parents avant enfants.
const order = [];
const seen = new Set();
const visit = (t, stack = new Set()) => {
  if (seen.has(t) || stack.has(t)) return;
  stack.add(t);
  for (const f of fks) if (f.child === t && f.parent !== t) visit(f.parent, stack);
  seen.add(t);
  order.push(t);
};
tables.forEach((t) => visit(t));

let total = 0;
for (const t of order) {
  const cols = (await src.query(`select column_name as c, data_type as d from information_schema.columns where table_schema='public' and table_name=$1`, [t])).rows;
  const json = new Set(cols.filter((c) => c.d === "jsonb" || c.d === "json").map((c) => c.c));
  const vec = new Set(cols.filter((c) => c.d === "USER-DEFINED").map((c) => c.c));
  const sel = cols.map((c) => (vec.has(c.c) ? `"${c.c}"::text as "${c.c}"` : `"${c.c}"`)).join(", ");
  const rows = (await src.query(`select ${sel} from "${t}"`)).rows.map((r) => {
    for (const k of json) if (r[k] !== null) r[k] = JSON.stringify(r[k]);
    return r;
  });
  if (!rows.length) continue;
  const selfRef = fks.some((f) => f.child === t && f.parent === t);
  const insert = (batch) => dst`insert into ${dst(t)} ${dst(batch, cols.map((c) => c.c))}`;
  if (!selfRef) {
    for (let i = 0; i < rows.length; i += 200) await insert(rows.slice(i, i + 200));
  } else {
    // Auto-référence (dossiers…) : on réessaie les lignes dont le parent n'est pas encore copié.
    let left = rows;
    while (left.length) {
      const next = [];
      for (const r of left) await insert([r]).catch((e) => (e.code === "23503" ? next.push(r) : Promise.reject(e)));
      if (next.length === left.length) throw new Error(`Copie impossible de ${t} (références circulaires)`);
      left = next;
    }
  }
  total += rows.length;
  console.log(`${t} : ${rows.length}`);
}

// Fichiers importés stockés sur le disque → table file_blobs.
const files = (await src.query(`select user_id, storage_key from files where storage_key is not null and is_folder = false`)).rows;
for (const f of files) {
  const p = path.join(root, ".data/files", f.user_id, f.storage_key);
  if (fs.existsSync(p)) await dst`insert into file_blobs (storage_key, user_id, data) values (${f.storage_key}, ${f.user_id}, ${fs.readFileSync(p)}) on conflict do nothing`;
}

await src.close();
await dst.end();
fs.rmSync(snap, { recursive: true, force: true });
console.log(`Copie terminée : ${total} lignes, ${files.length} fichier(s).`);
