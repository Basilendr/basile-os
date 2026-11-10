#!/usr/bin/env node
/**
 * Réinitialise le mot de passe BASILE OS du compte propriétaire et ferme toutes les sessions.
 *  - DATABASE_URL défini → base PostgreSQL (Neon…) ;
 *  - sinon → base embarquée PGlite (arrêter le serveur avant : PGlite n'accepte qu'un processus).
 * Le mot de passe est demandé au clavier (masqué) ; on peut aussi le passer en argument.
 *   node scripts/reset-password.mjs
 *   node --env-file=.env.neon scripts/reset-password.mjs
 */
import path from "node:path";
import { randomBytes, scryptSync } from "node:crypto";

async function ask(question) {
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let s = "";
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(s);
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f" || c === "\b") s = s.slice(0, -1);
        else s += c;
      }
    };
    stdin.on("data", onData);
  });
}

let pw = process.argv[2];
if (!pw) {
  pw = await ask("Nouveau mot de passe (10 caractères min.) : ");
  const again = await ask("Confirme le mot de passe : ");
  if (pw !== again) {
    console.error("Les deux mots de passe ne correspondent pas.");
    process.exit(1);
  }
}
if (!pw || pw.length < 10) {
  console.error("Le mot de passe doit contenir au moins 10 caractères.");
  process.exit(1);
}
const N = 2 ** 15;
const salt = randomBytes(16);
const hash = scryptSync(pw, salt, 64, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const stored = `scrypt$${N}$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;

let emails;
if (process.env.DATABASE_URL) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  const rows = await sql`update users set password_hash = ${stored} returning email`;
  await sql`delete from sessions`;
  emails = rows.map((x) => x.email);
  await sql.end();
} else {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const db = await PGlite.create({ dataDir: path.resolve(process.env.DATA_DIR ?? ".data", "pg"), extensions: { vector } });
  const r = await db.query("update users set password_hash = $1 returning email", [stored]);
  await db.query("delete from sessions");
  emails = r.rows.map((x) => x.email);
  await db.close();
}
console.log(emails.length ? `Mot de passe mis à jour pour ${emails.join(", ")} (toutes les sessions ont été fermées).` : "Aucun compte trouvé.");
process.exit(0);
