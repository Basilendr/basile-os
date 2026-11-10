import { route, zId } from "@/lib/api";
import { FilePatch, deleteFile, getFile, updateFile } from "@/services/files";

export const GET = route({}, async ({ db, user, params }) => {
  const { storageKey, ...f } = await getFile(db, user.id, zId.parse(params.id));
  void storageKey;
  return f;
});
export const PATCH = route({ body: FilePatch }, async ({ db, user, params, body }) => {
  const { storageKey, textContent, ...f } = await updateFile(db, user.id, zId.parse(params.id), body);
  void storageKey;
  void textContent;
  return f;
});
export const DELETE = route({}, async ({ db, user, params }) => deleteFile(db, user.id, zId.parse(params.id)));
