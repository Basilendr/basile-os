import { z } from "zod";
import { route } from "@/lib/api";
import { logSecurityEvent } from "@/lib/auth";
import { OutgoingZ } from "@/lib/email-schema";
import { sendMessage } from "@/services/google/gmail";
import { loadAttachments } from "@/services/files";

/** Envoi : exige `confirm: true` (confirmation explicite côté interface). */
export const POST = route({ body: OutgoingZ.extend({ confirm: z.literal(true) }), rate: [20, 60_000] }, async ({ db, user, body }) => {
  const attachments = await loadAttachments(db, user.id, body.fileIds);
  const r = await sendMessage(db, user.id, { ...body, attachments }, body.draftId);
  await logSecurityEvent(user.id, "email.sent", { to: body.to.length + body.cc.length + body.bcc.length, gmailId: r.id });
  return r;
});
