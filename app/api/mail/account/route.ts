import { route } from "@/lib/api";
import { logSecurityEvent } from "@/lib/auth";
import { log } from "@/lib/log";
import { MAIL_PRESETS, MailAccountInput, connectMail, disconnectMail, getMailAccount, publicMailAccount, syncMail } from "@/services/mail/mail";

export const GET = route({}, async ({ db, user }) => ({ ...publicMailAccount(await getMailAccount(db, user.id)), presets: MAIL_PRESETS }));

/** Identifiants IMAP/SMTP : vérifiés auprès des serveurs, chiffrés au repos, jamais renvoyés. */
export const POST = route({ body: MailAccountInput, rate: [6, 10 * 60_000] }, async ({ db, user, body }) => {
  const r = await connectMail(db, user.id, body);
  await logSecurityEvent(user.id, "mail.connected", { host: body.imapHost });
  syncMail(db, user.id).catch((e) => log.warn("mail.initial_sync_failed", { error: String(e) }));
  return r;
});

export const DELETE = route({}, async ({ db, user }) => {
  await disconnectMail(db, user.id);
  await logSecurityEvent(user.id, "mail.disconnected");
  return { ok: true };
});
