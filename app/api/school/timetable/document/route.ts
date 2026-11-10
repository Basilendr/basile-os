import { z } from "zod";
import { route } from "@/lib/api";
import { documentContent } from "@/services/school/documents";

const Q = z.object({ file: z.coerce.number().int().positive() });

/** Emploi du temps envoyé par la vie scolaire, affiché tel quel. */
export const GET = route({ query: Q }, async ({ db, user, query }) => {
  const doc = await documentContent(db, user.id, query.file);
  return new Response(new Uint8Array(doc.data), {
    headers: { "content-type": doc.mimeType, "content-disposition": `inline; filename="${encodeURIComponent(doc.name)}"`, "cache-control": "private, max-age=3600" },
  });
});
