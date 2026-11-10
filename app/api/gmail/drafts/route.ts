import { route } from "@/lib/api";
import { OutgoingZ } from "@/lib/email-schema";
import { saveDraft } from "@/services/google/gmail";
import { loadAttachments } from "@/services/files";

export const POST = route({ body: OutgoingZ.partial({ to: true }), rate: [60, 60_000] }, async ({ db, user, body }) => {
  const attachments = await loadAttachments(db, user.id, body.fileIds ?? []);
  return saveDraft(db, user.id, { ...body, to: body.to ?? [], attachments }, body.draftId);
});
