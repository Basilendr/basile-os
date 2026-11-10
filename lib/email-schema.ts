import { z } from "zod";

export const OutgoingZ = z.object({
  to: z.array(z.email()).min(1, "Au moins un destinataire").max(50),
  cc: z.array(z.email()).max(50).default([]),
  bcc: z.array(z.email()).max(50).default([]),
  subject: z.string().max(500).default(""),
  html: z.string().max(2_000_000).default(""),
  text: z.string().max(1_000_000).default(""),
  threadId: z.string().max(64).nullable().optional(),
  inReplyTo: z.string().max(1000).nullable().optional(),
  references: z.string().max(5000).nullable().optional(),
  /** fichiers déjà importés dans le gestionnaire de fichiers BASILE OS */
  fileIds: z.array(z.uuid()).max(10).default([]),
  draftId: z.string().max(64).nullable().optional(),
});
export type OutgoingInput = z.infer<typeof OutgoingZ>;
