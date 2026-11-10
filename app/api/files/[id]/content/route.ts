import { z } from "zod";
import { route, zId } from "@/lib/api";
import { readFileBytes } from "@/services/files";

/** Téléchargement / prévisualisation authentifiés. Les types actifs (HTML, SVG) sont forcés en téléchargement. */
export const GET = route({ query: z.object({ download: z.enum(["1"]).optional() }) }, async ({ db, user, params, query }) => {
  const { file, data } = await readFileBytes(db, user.id, zId.parse(params.id));
  const mime = file.mimeType ?? "application/octet-stream";
  const inlineSafe = !query.download && (/^image\/(png|jpeg|gif|webp|avif)$/.test(mime) || mime === "application/pdf" || mime === "text/plain");
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": inlineSafe ? mime : "application/octet-stream",
      "content-disposition": `${inlineSafe ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": mime === "application/pdf" && inlineSafe ? "default-src 'none'; frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox",
      "cache-control": "private, max-age=60",
    },
  });
});
