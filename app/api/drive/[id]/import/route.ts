import { z } from "zod";
import { route } from "@/lib/api";
import { driveContent } from "@/services/google/drive";
import { uploadFile } from "@/services/files";

/** Copie un fichier Drive dans le gestionnaire de fichiers Basile OS (recherche, IA, liaison aux projets). */
export const POST = route({ body: z.object({ projectId: z.uuid().nullable().optional() }), rate: [20, 60_000] }, async ({ db, user, params, body }) => {
  const { data, mimeType, name } = await driveContent(db, user.id, z.string().regex(/^[\w-]{5,200}$/).parse(params.id));
  const f = await uploadFile(db, user.id, new File([new Uint8Array(data)], name, { type: mimeType }), { parentId: null, projectId: body.projectId ?? null });
  return { id: f.id, name: f.name };
});
