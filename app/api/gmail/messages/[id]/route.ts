import { z } from "zod";
import { route } from "@/lib/api";
import { getMessage, modifyMessage, setLabels } from "@/services/google/gmail";

const gid = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);

export const GET = route({}, async ({ db, user, params }) => getMessage(db, user.id, gid.parse(params.id)));

const Body = z.union([
  z.object({ action: z.enum(["read", "unread", "star", "unstar", "archive", "unarchive", "important", "unimportant", "trash", "untrash", "spam", "notspam"]) }),
  z.object({ addLabels: z.array(z.string().max(100)).max(20).default([]), removeLabels: z.array(z.string().max(100)).max(20).default([]) }),
]);

export const POST = route({ body: Body }, async ({ db, user, params, body }) => {
  const id = gid.parse(params.id);
  if ("action" in body) return modifyMessage(db, user.id, id, body.action);
  return { id, labelIds: await setLabels(db, user.id, id, body.addLabels, body.removeLabels) };
});
