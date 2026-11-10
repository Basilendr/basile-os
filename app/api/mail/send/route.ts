import { route } from "@/lib/api";
import { logSecurityEvent } from "@/lib/auth";
import { SendInput, sendMail } from "@/services/mail/mail";

/** Envoi déclenché uniquement depuis l'interface, après confirmation de l'utilisateur. */
export const POST = route({ body: SendInput, rate: [20, 60_000] }, async ({ db, user, body }) => {
  const r = await sendMail(db, user.id, body);
  await logSecurityEvent(user.id, "mail.sent", { recipients: body.to.length });
  return r;
});
