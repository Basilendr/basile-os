#!/usr/bin/env node
/**
 * Diagnostic de connexion École Directe depuis ce Mac.
 * Demande l'identifiant et le mot de passe (masqué), essaie plusieurs variantes de requête
 * et affiche seulement le code et le message renvoyés par École Directe (jamais le mot de passe).
 *   node scripts/test-ecoledirecte.mjs
 */
const BASE = "https://api.ecoledirecte.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

async function ask(question, hidden) {
  process.stdout.write(question);
  const stdin = process.stdin;
  if (hidden) stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let s = "";
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          if (hidden) stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          if (hidden) process.stdout.write("\n");
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

function cookiesFrom(res, jar = new Map()) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const first = c.split(";")[0];
    const i = first.indexOf("=");
    if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
  return jar;
}
const serialize = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const esc = (_k, v) => (typeof v === "string" ? v.replaceAll("%", "%25").replaceAll("&", "%26").replaceAll("+", "%2B") : v);

async function attempt(label, { version, encode, username, password }) {
  const g = await fetch(`${BASE}/v3/login.awp?gtk=1&v=${version}`, { headers: { "user-agent": UA, accept: "application/json, text/plain, */*" } });
  const jar = cookiesFrom(g);
  const gtk = jar.get("GTK") || "";
  const data = { identifiant: username, motdepasse: password, isReLogin: false, uuid: "", fa: [] };
  const body = encode ? `data=${encodeURIComponent(JSON.stringify(data))}` : `data=${JSON.stringify(data, esc)}`;
  const r = await fetch(`${BASE}/v3/login.awp?v=${version}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA, accept: "application/json, text/plain, */*", cookie: serialize(jar), "x-gtk": gtk },
    body,
  });
  const json = await r.json().catch(() => ({}));
  console.log(`${label.padEnd(36)} → code ${json.code} ${json.message ?? ""}${json.code === 200 ? " ✅" : ""}${json.code === 250 ? " (question de sécurité : identifiants OK ✅)" : ""}`);
  return json.code;
}

const username = (await ask("Identifiant École Directe : ", false)).trim();
const password = await ask("Mot de passe École Directe (masqué) : ", true);
console.log(`(mot de passe reçu : ${password.length} caractères${password !== password.trim() ? ", avec des espaces au début ou à la fin" : ""})\n`);

await attempt("site officiel, version 4.104.3", { version: "4.104.3", encode: false, username, password });
await attempt("site officiel, version 4.101.4", { version: "4.101.4", encode: false, username, password });
await attempt("ancien encodage, version 4.101.4", { version: "4.101.4", encode: true, username, password });
process.exit(0);
