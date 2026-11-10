import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { gfetch, pool } from "./client";
import { isServiceConnected, upsertIntegration } from "./oauth";
import { emit } from "../events";
import { logActivity } from "../activity";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

type Header = { name: string; value: string };
type Part = { partId?: string; mimeType: string; filename?: string; headers?: Header[]; body?: { size: number; data?: string; attachmentId?: string }; parts?: Part[] };
export type GMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; historyId?: string; internalDate?: string; payload?: Part; sizeEstimate?: number };

export const isConnected = (db: DB, userId: string) => isServiceConnected(db, userId, "gmail");

async function requireGmail(db: DB, userId: string) {
  if (!(await isConnected(db, userId))) throw new AppError("not_configured", "Gmail n'est pas connecté. Connecte-le depuis la page Intégrations.");
}

const header = (p: Part | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

export function parseAddress(v: string): { name: string | null; email: string | null } {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  const e = v.trim();
  return { name: null, email: e.includes("@") ? e.toLowerCase() : null };
}

function hasAttachments(p?: Part): boolean {
  if (!p) return false;
  if (p.filename && p.body?.attachmentId) return true;
  return (p.parts ?? []).some(hasAttachments);
}

function toRow(m: GMessage): Omit<typeof schema.emailMessages.$inferInsert, "userId"> {
  const from = parseAddress(header(m.payload, "From"));
  const labels = m.labelIds ?? [];
  return {
    gmailId: m.id,
    threadId: m.threadId,
    historyId: m.historyId ?? null,
    fromName: from.name,
    fromEmail: from.email,
    to: header(m.payload, "To"),
    cc: header(m.payload, "Cc"),
    subject: header(m.payload, "Subject"),
    snippet: decodeEntities(m.snippet ?? ""),
    internalDate: new Date(Number(m.internalDate ?? Date.now())),
    labelIds: labels,
    isUnread: labels.includes("UNREAD"),
    isStarred: labels.includes("STARRED"),
    isImportant: labels.includes("IMPORTANT"),
    hasAttachments: hasAttachments(m.payload),
  };
}

function decodeEntities(s: string) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function fetchMeta(db: DB, userId: string, id: string) {
  return gfetch<GMessage>(db, userId, `${API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`);
}

async function upsertRows(db: DB, userId: string, msgs: GMessage[]) {
  for (const m of msgs) {
    const v = toRow(m);
    await db
      .insert(schema.emailMessages)
      .values({ ...v, userId })
      .onConflictDoUpdate({ target: [schema.emailMessages.userId, schema.emailMessages.gmailId], set: { ...v } });
  }
}

/* ------------------------------------------------------------------ synchronisation */

/**
 * Synchronisation : complète au premier passage (30 derniers jours, paginée),
 * puis incrémentale via history.list. Les doublons sont impossibles (clé unique user+gmail_id).
 */
export async function syncGmail(db: DB, userId: string) {
  await requireGmail(db, userId);
  const [integ] = await db.select().from(schema.integrations).where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.service, "gmail")));
  const state = (integ?.syncState ?? {}) as { historyId?: string };
  try {
    let result: { added: number; updated: number; removed: number; full: boolean };
    if (state.historyId) {
      try {
        result = await incremental(db, userId, state.historyId);
      } catch (e) {
        if (e instanceof AppError && e.code === "not_found") result = await fullSync(db, userId);
        else throw e;
      }
    } else result = await fullSync(db, userId);
    return result;
  } catch (e) {
    log.error("gmail.sync_failed", { userId, error: String(e) });
    await upsertIntegration(db, userId, "gmail", { lastError: (e as Error).message });
    throw e;
  }
}

async function fullSync(db: DB, userId: string) {
  const profile = await gfetch<{ historyId: string; emailAddress: string }>(db, userId, `${API}/profile`);
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({ maxResults: "100", q: "newer_than:30d -in:chats" });
    if (pageToken) p.set("pageToken", pageToken);
    const page = await gfetch<{ messages?: { id: string }[]; nextPageToken?: string }>(db, userId, `${API}/messages?${p}`);
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = ids.length < 500 ? page.nextPageToken : undefined;
  } while (pageToken);
  const msgs = await pool(ids, 8, (id) => fetchMeta(db, userId, id).catch(() => null));
  await upsertRows(db, userId, msgs.filter((m): m is GMessage => !!m));
  await upsertIntegration(db, userId, "gmail", { lastSyncAt: new Date(), lastError: null, syncState: { historyId: profile.historyId }, accountEmail: profile.emailAddress });
  return { added: ids.length, updated: 0, removed: 0, full: true };
}

type History = {
  id: string;
  messagesAdded?: { message: GMessage }[];
  messagesDeleted?: { message: GMessage }[];
  labelsAdded?: { message: GMessage }[];
  labelsRemoved?: { message: GMessage }[];
};

async function incremental(db: DB, userId: string, startHistoryId: string) {
  const added = new Set<string>();
  const changed = new Set<string>();
  const removed = new Set<string>();
  let pageToken: string | undefined;
  let lastHistory = startHistoryId;
  do {
    const p = new URLSearchParams({ startHistoryId, maxResults: "500" });
    if (pageToken) p.set("pageToken", pageToken);
    const page = await gfetch<{ history?: History[]; nextPageToken?: string; historyId: string }>(db, userId, `${API}/history?${p}`);
    for (const h of page.history ?? []) {
      h.messagesAdded?.forEach((x) => added.add(x.message.id));
      h.labelsAdded?.forEach((x) => changed.add(x.message.id));
      h.labelsRemoved?.forEach((x) => changed.add(x.message.id));
      h.messagesDeleted?.forEach((x) => removed.add(x.message.id));
    }
    lastHistory = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);

  for (const id of removed) {
    added.delete(id);
    changed.delete(id);
  }
  const toFetch = [...new Set([...added, ...changed])];
  const msgs = (await pool(toFetch, 8, (id) => fetchMeta(db, userId, id).catch(() => null))).filter((m): m is GMessage => !!m);
  const existing = toFetch.length
    ? new Set(
        (await db.select({ id: schema.emailMessages.gmailId }).from(schema.emailMessages).where(and(eq(schema.emailMessages.userId, userId), inArray(schema.emailMessages.gmailId, toFetch)))).map(
          (r) => r.id,
        ),
      )
    : new Set<string>();
  await upsertRows(db, userId, msgs);
  if (removed.size) await db.delete(schema.emailMessages).where(and(eq(schema.emailMessages.userId, userId), inArray(schema.emailMessages.gmailId, [...removed])));

  // Événements « email reçu » uniquement pour les nouveaux messages de la boîte de réception
  for (const m of msgs) {
    if (!existing.has(m.id) && added.has(m.id) && m.labelIds?.includes("INBOX")) {
      const row = toRow(m);
      await emit(db, {
        type: "email.received",
        userId,
        entityType: "email",
        entityId: m.id,
        data: { subject: row.subject, from: row.fromEmail, fromName: row.fromName, snippet: row.snippet, important: row.isImportant, labels: row.labelIds },
        key: `email.received:${m.id}`,
      });
    }
  }
  await upsertIntegration(db, userId, "gmail", { lastSyncAt: new Date(), lastError: null, syncState: { historyId: lastHistory } });
  return { added: added.size, updated: changed.size, removed: removed.size, full: false };
}

/* ------------------------------------------------------------------ lecture */

export const FOLDERS = {
  primary: { label: "Principaux", q: "in:inbox category:primary" },
  inbox: { label: "Boîte de réception", q: "in:inbox" },
  unread: { label: "Non lus", q: "in:inbox is:unread" },
  starred: { label: "Favoris", q: "is:starred" },
  important: { label: "Importants", q: "is:important" },
  sent: { label: "Envoyés", q: "in:sent" },
  drafts: { label: "Brouillons", q: "in:drafts" },
  archived: { label: "Archivés", q: "-in:inbox -in:sent -in:drafts -in:spam -in:trash -in:chats" },
  spam: { label: "Spam", q: "in:spam" },
  all: { label: "Tous", q: "-in:chats -in:spam -in:trash" },
} as const;
export type Folder = keyof typeof FOLDERS;

/** Liste via l'API Gmail (syntaxe native prise en charge), métadonnées mises en cache localement. */
export async function listMessages(db: DB, userId: string, opts: { folder: Folder; q?: string; pageToken?: string; limit?: number }) {
  await requireGmail(db, userId);
  const q = [FOLDERS[opts.folder].q, opts.q].filter(Boolean).join(" ");
  const p = new URLSearchParams({ maxResults: String(opts.limit ?? 40), q });
  if (opts.folder === "spam") p.set("includeSpamTrash", "true");
  if (opts.pageToken) p.set("pageToken", opts.pageToken);
  const page = await gfetch<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string; resultSizeEstimate?: number }>(db, userId, `${API}/messages?${p}`);
  const ids = (page.messages ?? []).map((m) => m.id);
  if (!ids.length) return { items: [], nextPageToken: null };
  // Toujours rafraîchir les métadonnées affichées (labels lu/non lu à jour)
  const msgs = (await pool(ids, 8, (id) => fetchMeta(db, userId, id).catch(() => null))).filter((m): m is GMessage => !!m);
  await upsertRows(db, userId, msgs);
  const rows = await db.select().from(schema.emailMessages).where(and(eq(schema.emailMessages.userId, userId), inArray(schema.emailMessages.gmailId, ids)));
  const byId = new Map(rows.map((r) => [r.gmailId, r]));
  return { items: ids.map((id) => byId.get(id)).filter(Boolean) as (typeof rows)[number][], nextPageToken: page.nextPageToken ?? null };
}

function b64url(data: string) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function collect(p: Part, out: { text: string[]; html: string[]; attachments: { id: string; filename: string; mimeType: string; size: number }[] }) {
  if (p.filename && p.body?.attachmentId) {
    out.attachments.push({ id: p.body.attachmentId, filename: p.filename, mimeType: p.mimeType, size: p.body.size });
  } else if (p.mimeType === "text/plain" && p.body?.data) out.text.push(b64url(p.body.data).toString("utf8"));
  else if (p.mimeType === "text/html" && p.body?.data) out.html.push(b64url(p.body.data).toString("utf8"));
  for (const c of p.parts ?? []) collect(c, out);
}

export async function getMessage(db: DB, userId: string, id: string) {
  await requireGmail(db, userId);
  const m = await gfetch<GMessage>(db, userId, `${API}/messages/${encodeURIComponent(id)}?format=full`);
  await upsertRows(db, userId, [m]);
  const out = { text: [] as string[], html: [] as string[], attachments: [] as { id: string; filename: string; mimeType: string; size: number }[] };
  if (m.payload) collect(m.payload, out);
  const row = toRow(m);
  return {
    ...row,
    id: m.id,
    date: header(m.payload, "Date"),
    replyTo: header(m.payload, "Reply-To"),
    messageIdHeader: header(m.payload, "Message-ID") || header(m.payload, "Message-Id"),
    references: header(m.payload, "References"),
    textBody: out.text.join("\n\n"),
    htmlBody: out.html.join("\n"),
    attachments: out.attachments,
  };
}

export async function getThread(db: DB, userId: string, threadId: string) {
  await requireGmail(db, userId);
  const t = await gfetch<{ id: string; messages: GMessage[] }>(db, userId, `${API}/threads/${encodeURIComponent(threadId)}?format=full`);
  return t.messages.map((m) => {
    const out = { text: [] as string[], html: [] as string[], attachments: [] as { id: string; filename: string; mimeType: string; size: number }[] };
    if (m.payload) collect(m.payload, out);
    return { ...toRow(m), id: m.id, date: header(m.payload, "Date"), textBody: out.text.join("\n\n"), htmlBody: out.html.join("\n"), attachments: out.attachments };
  });
}

export async function getAttachment(db: DB, userId: string, messageId: string, attachmentId: string) {
  await requireGmail(db, userId);
  const a = await gfetch<{ data: string; size: number }>(db, userId, `${API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  return b64url(a.data);
}

export async function listLabels(db: DB, userId: string) {
  await requireGmail(db, userId);
  const r = await gfetch<{ labels: { id: string; name: string; type: string; color?: { backgroundColor: string } }[] }>(db, userId, `${API}/labels`);
  return r.labels;
}

/* ------------------------------------------------------------------ actions */

export type ModifyAction = "read" | "unread" | "star" | "unstar" | "archive" | "unarchive" | "important" | "unimportant" | "trash" | "untrash" | "spam" | "notspam";

const ACTIONS: Record<Exclude<ModifyAction, "trash" | "untrash">, { add?: string[]; remove?: string[] }> = {
  read: { remove: ["UNREAD"] },
  unread: { add: ["UNREAD"] },
  star: { add: ["STARRED"] },
  unstar: { remove: ["STARRED"] },
  archive: { remove: ["INBOX"] },
  unarchive: { add: ["INBOX"] },
  important: { add: ["IMPORTANT"] },
  unimportant: { remove: ["IMPORTANT"] },
  spam: { add: ["SPAM"], remove: ["INBOX"] },
  notspam: { add: ["INBOX"], remove: ["SPAM"] },
};

/** Action explicite de l'utilisateur sur un message — jamais déclenchée automatiquement. */
export async function modifyMessage(db: DB, userId: string, id: string, action: ModifyAction, labels?: { add?: string[]; remove?: string[] }) {
  await requireGmail(db, userId);
  let m: GMessage;
  if (action === "trash" || action === "untrash") {
    m = await gfetch<GMessage>(db, userId, `${API}/messages/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  } else {
    const a = ACTIONS[action];
    m = await gfetch<GMessage>(db, userId, `${API}/messages/${encodeURIComponent(id)}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: [...(a.add ?? []), ...(labels?.add ?? [])], removeLabelIds: [...(a.remove ?? []), ...(labels?.remove ?? [])] }),
    });
  }
  await db
    .update(schema.emailMessages)
    .set({ labelIds: m.labelIds ?? [], isUnread: !!m.labelIds?.includes("UNREAD"), isStarred: !!m.labelIds?.includes("STARRED"), isImportant: !!m.labelIds?.includes("IMPORTANT") })
    .where(and(eq(schema.emailMessages.userId, userId), eq(schema.emailMessages.gmailId, id)));
  if (action === "trash") await logActivity(db, userId, { type: "email.trashed", title: "Email placé dans la corbeille", entityType: "email", entityId: id });
  return { id, labelIds: m.labelIds ?? [] };
}

export async function setLabels(db: DB, userId: string, id: string, add: string[], remove: string[]) {
  await requireGmail(db, userId);
  const m = await gfetch<GMessage>(db, userId, `${API}/messages/${encodeURIComponent(id)}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
  await db.update(schema.emailMessages).set({ labelIds: m.labelIds ?? [] }).where(and(eq(schema.emailMessages.userId, userId), eq(schema.emailMessages.gmailId, id)));
  return m.labelIds ?? [];
}

/* ------------------------------------------------------------------ rédaction */

export type Outgoing = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: { filename: string; mimeType: string; data: Buffer }[];
};

const encodeHeader = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString("base64")}?=`);
const stripCrlf = (v: string) => v.replace(/[\r\n]+/g, " ");

/** Construit un message RFC 2822 (multipart) — en-têtes protégés contre l'injection CRLF. */
export function buildMime(m: Outgoing) {
  const boundary = `bos_${Math.random().toString(36).slice(2)}`;
  const alt = `alt_${Math.random().toString(36).slice(2)}`;
  const h: string[] = [
    `To: ${stripCrlf(m.to.join(", "))}`,
    m.cc?.length ? `Cc: ${stripCrlf(m.cc.join(", "))}` : "",
    m.bcc?.length ? `Bcc: ${stripCrlf(m.bcc.join(", "))}` : "",
    `Subject: ${encodeHeader(stripCrlf(m.subject))}`,
    m.inReplyTo ? `In-Reply-To: ${stripCrlf(m.inReplyTo)}` : "",
    m.inReplyTo || m.references ? `References: ${stripCrlf([m.references, m.inReplyTo].filter(Boolean).join(" "))}` : "",
    "MIME-Version: 1.0",
  ].filter(Boolean);
  const altPart = [
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.text).toString("base64"),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.html).toString("base64"),
    `--${alt}--`,
  ].join("\r\n");
  let body: string;
  if (m.attachments?.length) {
    h.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      altPart,
      ...m.attachments.flatMap((a) => [
        `--${boundary}`,
        `Content-Type: ${stripCrlf(a.mimeType)}; name="${encodeHeader(stripCrlf(a.filename))}"`,
        `Content-Disposition: attachment; filename="${encodeHeader(stripCrlf(a.filename))}"`,
        "Content-Transfer-Encoding: base64",
        "",
        a.data.toString("base64").replace(/.{76}/g, "$&\r\n"),
      ]),
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    h.push(`Content-Type: multipart/alternative; boundary="${alt}"`);
    body = altPart;
  }
  return Buffer.from(`${h.join("\r\n")}\r\n\r\n${body}`).toString("base64url");
}

export async function saveDraft(db: DB, userId: string, m: Outgoing, draftId?: string | null) {
  await requireGmail(db, userId);
  const payload = JSON.stringify({ id: draftId ?? undefined, message: { raw: buildMime(m), threadId: m.threadId ?? undefined } });
  const d = draftId
    ? await gfetch<{ id: string; message: { id: string } }>(db, userId, `${API}/drafts/${encodeURIComponent(draftId)}`, { method: "PUT", body: payload })
    : await gfetch<{ id: string; message: { id: string } }>(db, userId, `${API}/drafts`, { method: "POST", body: payload });
  return { draftId: d.id, messageId: d.message.id };
}

export async function deleteDraft(db: DB, userId: string, draftId: string) {
  await requireGmail(db, userId);
  await gfetch(db, userId, `${API}/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
}

/** Envoi — le message n'est considéré envoyé qu'après la réponse positive de l'API Gmail. */
export async function sendMessage(db: DB, userId: string, m: Outgoing, draftId?: string | null) {
  await requireGmail(db, userId);
  let sent: GMessage;
  if (draftId) {
    await saveDraft(db, userId, m, draftId);
    sent = await gfetch<GMessage>(db, userId, `${API}/drafts/send`, { method: "POST", body: JSON.stringify({ id: draftId }) });
  } else {
    sent = await gfetch<GMessage>(db, userId, `${API}/messages/send`, { method: "POST", body: JSON.stringify({ raw: buildMime(m), threadId: m.threadId ?? undefined }) });
  }
  if (!sent?.id) throw new AppError("integration_error", "Gmail n'a pas confirmé l'envoi.");
  await logActivity(db, userId, { type: "email.sent", title: `Email envoyé : ${m.subject}`, entityType: "email", entityId: sent.id, meta: { to: m.to } });
  await emit(db, { type: "email.sent", userId, entityType: "email", entityId: sent.id, data: { subject: m.subject, to: m.to }, key: `email.sent:${sent.id}` });
  return { id: sent.id, threadId: sent.threadId };
}

export async function getDraft(db: DB, userId: string, draftId: string) {
  await requireGmail(db, userId);
  return gfetch<{ id: string; message: GMessage }>(db, userId, `${API}/drafts/${encodeURIComponent(draftId)}?format=full`);
}

export async function listDrafts(db: DB, userId: string) {
  await requireGmail(db, userId);
  const r = await gfetch<{ drafts?: { id: string; message: { id: string; threadId: string } }[] }>(db, userId, `${API}/drafts?maxResults=50`);
  return r.drafts ?? [];
}
