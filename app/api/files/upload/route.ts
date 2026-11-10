import { z } from "zod";
import { route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { uploadFile } from "@/services/files";

export const POST = route({ rate: [60, 60_000] }, async ({ db, user, req }) => {
  const form = await req.formData().catch(() => {
    throw new AppError("bad_request", "Formulaire multipart invalide");
  });
  const parentId = z.uuid().nullable().parse((form.get("parentId") as string) || null);
  const projectId = z.uuid().nullable().parse((form.get("projectId") as string) || null);
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) throw new AppError("bad_request", "Aucun fichier reçu");
  const items = [];
  for (const f of files.slice(0, 20)) items.push(await uploadFile(db, user.id, f, { parentId, projectId }));
  return { items: items.map(({ textContent, storageKey, ...r }) => (void textContent, void storageKey, r)) };
});
