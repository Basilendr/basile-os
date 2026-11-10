import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { AppError, notFound } from "@/lib/errors";
import { log } from "@/lib/log";
import { notify } from "../notifications";

/**
 * Messagerie « classique » : n'importe quelle adresse email lue en IMAP et envoyée en SMTP.
 * Le mot de passe (de préférence un mot de passe d'application) est chiffré au repos et
 * n'est jamais renvoyé au navigateur. Les contenus reçus sont des données non fiables.
 */

/** Réglages des fournisseurs courants (modifiables dans le formulaire « Autre »). */
export const MAIL_PRESETS = {
  orange: { label: "Orange", imap: ["imap.orange.fr", 993, true], smtp: ["smtp.orange.fr", 465, true], note: "Mot de passe du compte Orange." },
  free: { label: "Free", imap: ["imap.free.fr", 993, true], smtp: ["smtp.free.fr", 465, true], note: "Mot de passe de la boîte Free (activer l'IMAP dans Zimbra si besoin)." },
  sfr: { label: "SFR", imap: ["imap.sfr.fr", 993, true], smtp: ["smtp.sfr.fr", 465, true], note: "Mot de passe du compte SFR Mail." },
  laposte: { label: "La Poste", imap: ["imap.laposte.net", 993, true], smtp: ["smtp.laposte.net", 465, true], note: "Activer l'accès IMAP dans les paramètres de laposte.net." },
  icloud: { label: "iCloud", imap: ["imap.mail.me.com", 993, true], smtp: ["smtp.mail.me.com", 587, false], note: "Adresse @icloud.com + « mot de passe pour app » (pas ton mot de passe Apple) : account.apple.com → Connexion et sécurité → Mots de passe pour app." },
  yahoo: { label: "Yahoo", imap: ["imap.mail.yahoo.com", 993, true], smtp: ["smtp.mail.yahoo.com", 465, true], note: "Mot de passe d'application à générer dans la sécurité du compte Yahoo." },
  outlook: { label: "Outlook / Hotmail", imap: ["outlook.office365.com", 993, true], smtp: ["smtp-mail.outlook.com", 587, false], note: "Microsoft bloque souvent les mots de passe simples : la connexion peut être refusée pour les comptes personnels." },
  other: { label: "Autre", imap: ["", 993, true], smtp: ["", 465, true], note: "Renseigne les serveurs indiqués par ton fournisseur." },
} as const satisfies Record<string, { label: string; imap: readonly [string, number, boolean]; smtp: readonly [string, number, boolean]; note: string }>;

export const MailAccountInput = z.object({
  email: z.email(),
  displayName: z.string().trim().max(120).optional(),
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500),
  imapHost: z.string().trim().min(3).max(200).regex(/^[a-z0-9.-]+$/i, "Serveur IMAP invalide"),
  imapPort: z.number().int().min(1).max(65535),
  imapSecure: z.boolean(),
  smtpHost: z.string().trim().min(3).max(200).regex(/^[a-z0-9.-]+$/i, "Serveur SMTP invalide"),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
});

type Account = typeof schema.mailAccounts.$inferSelect;
type Conn = { host: string; port: number; secure: boolean; user: string; pass: string };

const imapClient = (c: Conn) => new ImapFlow({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout: 30_000, greetingTimeout: 15_000 });
const connOf = (a: Account): Conn => ({ host: a.imapHost, port: a.imapPort, secure: a.imapSecure, user: a.username, pass: decrypt(a.passwordEnc) });
/** iCloud : l'envoi SMTP se fait toujours avec l'adresse complète, même si l'IMAP accepte le nom seul. */
const smtpUser = (a: { smtpHost: string; email: string; username: string }) => (isICloud(a.smtpHost) ? a.email : a.username);

/** Identifiants IMAP à essayer : celui saisi, puis l'adresse complète ou le nom seul (variantes acceptées par iCloud). */
function usernameCandidates(v: { email: string; username: string; imapHost: string }) {
  const local = v.email.split("@")[0];
  const list = [v.username, v.email];
  if (isICloud(v.imapHost) && /@(icloud|me|mac)\.com$/i.test(v.email)) list.push(local);
  return [...new Set(list.filter(Boolean))];
}

const isICloud = (host: string) => /(^|\.)mail\.me\.com$/i.test(host);
const isAuthError = (e: unknown) => {
  const err = e as { authenticationFailed?: boolean; responseCode?: number; message?: string; responseText?: string };
  return Boolean(err.authenticationFailed || err.responseCode === 535 || err.responseCode === 534 || /auth|login|credentials|password/i.test(`${err.message ?? ""} ${err.responseText ?? ""}`));
};

/** Message d'erreur compréhensible à partir des erreurs IMAP / SMTP / réseau. */
function friendly(e: unknown, what: "IMAP" | "SMTP", host = "") {
  const err = e as { authenticationFailed?: boolean; code?: string; responseCode?: number; message?: string };
  if (isAuthError(e) && isICloud(host))
    return new AppError(
      "invalid_credentials",
      "iCloud refuse la connexion. Il faut un « mot de passe pour app » (ton mot de passe Apple habituel ne marche pas ici) : account.apple.com → Connexion et sécurité → Mots de passe pour app. Utilise ton adresse @icloud.com, et vérifie que iCloud Mail est activé sur ton iPhone (Réglages → ton nom → iCloud → Mail iCloud).",
    );
  if (isAuthError(e))
    return new AppError("invalid_credentials", `Identifiant ou mot de passe refusé par le serveur ${what}. Beaucoup de fournisseurs exigent un « mot de passe d'application ».`);
  if (["ENOTFOUND", "EAI_AGAIN"].includes(err.code ?? "")) return new AppError("integration_error", `Serveur ${what} introuvable : vérifie son adresse.`);
  if (["ECONNREFUSED", "ETIMEDOUT", "ESOCKET", "ECONNECTION"].includes(err.code ?? "")) return new AppError("integration_error", `Connexion au serveur ${what} impossible : vérifie le port et le chiffrement.`);
  return new AppError("integration_error", `Erreur ${what} : ${(err.message ?? "inconnue").slice(0, 200)}`);
}

export async function getMailAccount(db: DB, userId: string) {
  const [a] = await db.select().from(schema.mailAccounts).where(eq(schema.mailAccounts.userId, userId));
  return a ?? null;
}

export function publicMailAccount(a: Account | null) {
  if (!a) return { status: "disconnected" as const };
  return { status: a.status as "connected" | "error", email: a.email, displayName: a.displayName, imapHost: a.imapHost, smtpHost: a.smtpHost, lastSyncAt: a.lastSyncAt, lastError: a.lastError };
}

/** Vérifie réellement l'accès IMAP puis SMTP avant d'enregistrer quoi que ce soit. */
export async function connectMail(db: DB, userId: string, raw: z.input<typeof MailAccountInput>) {
  const parsed = MailAccountInput.parse(raw);
  // Les mots de passe d'application sont souvent copiés avec des espaces parasites.
  const v = { ...parsed, email: parsed.email.trim().toLowerCase(), password: isICloud(parsed.imapHost) ? parsed.password.replace(/\s+/g, "") : parsed.password.trim() };
  let lastError: unknown = null;
  let imapUser: string | null = null;
  for (const user of usernameCandidates(v)) {
    const client = imapClient({ host: v.imapHost, port: v.imapPort, secure: v.imapSecure, user, pass: v.password });
    try {
      await client.connect();
      await client.logout();
      imapUser = user;
      break;
    } catch (e) {
      lastError = e;
      client.close();
      const err = e as { code?: string; responseText?: string; response?: string };
      log.warn("mail.imap_login_failed", { host: v.imapHost, code: err.code, auth: isAuthError(e), response: String(err.responseText ?? err.response ?? "").slice(0, 160) });
      if (!isAuthError(e)) break; // problème réseau ou serveur : inutile d'essayer d'autres identifiants
    }
  }
  if (!imapUser) throw friendly(lastError, "IMAP", v.imapHost);
  const sendUser = smtpUser({ smtpHost: v.smtpHost, email: v.email, username: imapUser });
  const transport = nodemailer.createTransport({ host: v.smtpHost, port: v.smtpPort, secure: v.smtpSecure, requireTLS: !v.smtpSecure, auth: { user: sendUser, pass: v.password }, connectionTimeout: 15_000 });
  try {
    await transport.verify();
  } catch (e) {
    const err = e as { code?: string; response?: string };
    log.warn("mail.smtp_login_failed", { host: v.smtpHost, code: err.code, response: String(err.response ?? "").slice(0, 160) });
    throw friendly(e, "SMTP", v.smtpHost);
  } finally {
    transport.close();
  }
  v.username = imapUser;
  const { password, ...rest } = v;
  const values = { ...rest, displayName: rest.displayName || null, passwordEnc: encrypt(password), status: "connected", lastError: null };
  await db.insert(schema.mailAccounts).values({ userId, ...values }).onConflictDoUpdate({ target: schema.mailAccounts.userId, set: values });
  return publicMailAccount(await getMailAccount(db, userId));
}

export async function disconnectMail(db: DB, userId: string) {
  await db.delete(schema.mailMessages).where(eq(schema.mailMessages.userId, userId));
  await db.delete(schema.mailAccounts).where(eq(schema.mailAccounts.userId, userId));
}

/** Synchronise les 60 derniers messages de la boîte de réception (en-têtes ; le contenu est chargé à l'ouverture). */
export async function syncMail(db: DB, userId: string) {
  const a = await getMailAccount(db, userId);
  if (!a) throw new AppError("not_configured", "Aucune adresse email classique n'est connectée.");
  const client = imapClient(connOf(a));
  let added = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const total = typeof client.mailbox === "object" && client.mailbox ? client.mailbox.exists : 0;
      if (total > 0) {
        const known = new Set((await db.select({ uid: schema.mailMessages.uid }).from(schema.mailMessages).where(and(eq(schema.mailMessages.userId, userId), eq(schema.mailMessages.folder, "INBOX")))).map((r) => r.uid));
        const from = Math.max(1, total - 59);
        for await (const m of client.fetch(`${from}:*`, { uid: true, envelope: true, flags: true, bodyStructure: true })) {
          const seen = m.flags?.has("\\Seen") ?? false;
          if (known.has(m.uid)) {
            await db.update(schema.mailMessages).set({ seen }).where(and(eq(schema.mailMessages.userId, userId), eq(schema.mailMessages.folder, "INBOX"), eq(schema.mailMessages.uid, m.uid)));
            continue;
          }
          const env = m.envelope;
          const sender = env?.from?.[0];
          const hasAttachments = JSON.stringify(m.bodyStructure ?? {}).includes('"disposition":"attachment"');
          await db
            .insert(schema.mailMessages)
            .values({
              userId,
              folder: "INBOX",
              uid: m.uid,
              messageId: env?.messageId ?? null,
              fromName: sender?.name || null,
              fromEmail: sender?.address ?? null,
              to: (env?.to ?? []).map((t) => t.address).filter(Boolean).join(", "),
              subject: env?.subject ?? "",
              date: env?.date ? new Date(env.date) : new Date(),
              seen,
              hasAttachments,
            })
            .onConflictDoNothing();
          added++;
          if (!seen && known.size > 0) await notify(db, userId, { type: "email", title: `Nouveau message de ${sender?.name || sender?.address || "inconnu"}`, body: env?.subject ?? "", href: "/inbox?box=mail", importance: "normal" }).catch(() => null);
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    await db.update(schema.mailAccounts).set({ lastSyncAt: new Date(), lastError: null, status: "connected" }).where(eq(schema.mailAccounts.userId, userId));
    return { added };
  } catch (e) {
    const err = e instanceof AppError ? e : friendly(e, "IMAP", a.imapHost);
    await db.update(schema.mailAccounts).set({ lastError: err.message, status: err.code === "invalid_credentials" ? "error" : a.status }).where(eq(schema.mailAccounts.userId, userId));
    client.close();
    throw err;
  }
}

export async function listMail(db: DB, userId: string) {
  return db
    .select({ id: schema.mailMessages.id, subject: schema.mailMessages.subject, fromName: schema.mailMessages.fromName, fromEmail: schema.mailMessages.fromEmail, date: schema.mailMessages.date, seen: schema.mailMessages.seen, hasAttachments: schema.mailMessages.hasAttachments })
    .from(schema.mailMessages)
    .where(eq(schema.mailMessages.userId, userId))
    .orderBy(desc(schema.mailMessages.date))
    .limit(200);
}

export async function unreadMailCount(db: DB, userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.mailMessages).where(and(eq(schema.mailMessages.userId, userId), eq(schema.mailMessages.seen, false)));
  return r?.n ?? 0;
}

/** Contenu d'un message : téléchargé et analysé à la première ouverture, puis marqué comme lu sur le serveur. */
export async function readMail(db: DB, userId: string, id: string) {
  const [m] = await db.select().from(schema.mailMessages).where(and(eq(schema.mailMessages.id, id), eq(schema.mailMessages.userId, userId)));
  if (!m) throw notFound("Message");
  if (m.html !== null || m.text !== null) return m;
  const a = await getMailAccount(db, userId);
  if (!a) throw new AppError("not_configured", "Aucune adresse email classique n'est connectée.");
  const client = imapClient(connOf(a));
  try {
    await client.connect();
    const lock = await client.getMailboxLock(m.folder);
    let parsed;
    try {
      const msg = await client.fetchOne(String(m.uid), { source: true }, { uid: true });
      if (!msg || !msg.source) throw notFound("Message");
      if (msg.source.length > 15 * 1024 * 1024) throw new AppError("bad_request", "Message trop volumineux pour être affiché ici.");
      parsed = await simpleParser(msg.source);
      await client.messageFlagsAdd(String(m.uid), ["\\Seen"], { uid: true }).catch(() => null);
    } finally {
      lock.release();
    }
    await client.logout();
    const [u] = await db
      .update(schema.mailMessages)
      .set({
        html: typeof parsed.html === "string" ? parsed.html : null,
        text: parsed.text ?? "",
        seen: true,
        attachments: (parsed.attachments ?? []).map((x) => ({ name: x.filename ?? "pièce jointe", size: x.size, type: x.contentType })),
      })
      .where(eq(schema.mailMessages.id, id))
      .returning();
    return u;
  } catch (e) {
    client.close();
    throw e instanceof AppError ? e : friendly(e, "IMAP", a.imapHost);
  }
}

export const SendInput = z.object({
  to: z.array(z.email()).min(1).max(20),
  subject: z.string().trim().max(300),
  body: z.string().max(100_000),
  inReplyTo: z.string().max(500).optional(),
});

/** Envoi SMTP. N'est appelé qu'après confirmation explicite dans l'interface ; considéré envoyé uniquement si le serveur l'accepte. */
export async function sendMail(db: DB, userId: string, raw: z.input<typeof SendInput>) {
  const v = SendInput.parse(raw);
  const a = await getMailAccount(db, userId);
  if (!a) throw new AppError("not_configured", "Aucune adresse email classique n'est connectée.");
  const transport = nodemailer.createTransport({ host: a.smtpHost, port: a.smtpPort, secure: a.smtpSecure, requireTLS: !a.smtpSecure, auth: { user: smtpUser(a), pass: decrypt(a.passwordEnc) }, connectionTimeout: 15_000 });
  try {
    const info = await transport.sendMail({
      from: a.displayName ? { name: a.displayName, address: a.email } : a.email,
      to: v.to,
      subject: v.subject,
      text: v.body,
      ...(v.inReplyTo ? { inReplyTo: v.inReplyTo, references: v.inReplyTo } : {}),
    });
    if (!info.accepted?.length) throw new AppError("integration_error", "Le serveur SMTP n'a accepté aucun destinataire.");
    log.info("mail.sent", { userId, recipients: info.accepted.length });
    return { messageId: info.messageId, accepted: info.accepted.length };
  } catch (e) {
    throw e instanceof AppError ? e : friendly(e, "SMTP", a.smtpHost);
  } finally {
    transport.close();
  }
}
