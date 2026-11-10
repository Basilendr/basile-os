import { z } from "zod";
import { route } from "@/lib/api";
import { driveContent } from "@/services/google/drive";

/** Aperçu / téléchargement d'un fichier Drive via le serveur (le jeton Google n'atteint jamais le navigateur). */
export const GET = route({ query: z.object({ download: z.enum(["1"]).optional() }), rate: [60, 60_000] }, async ({ db, user, params, query }) => {
  const { data, mimeType, name } = await driveContent(db, user.id, z.string().regex(/^[\w-]{5,200}$/).parse(params.id));
  const inlineSafe = !query.download && (/^image\/(png|jpeg|gif|webp)$/.test(mimeType) || mimeType === "application/pdf" || mimeType === "text/plain");
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": inlineSafe ? mimeType : "application/octet-stream",
      "content-disposition": `${inlineSafe ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=120",
    },
  });
});
