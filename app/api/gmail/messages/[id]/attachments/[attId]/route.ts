import { z } from "zod";
import { route } from "@/lib/api";
import { getAttachment } from "@/services/google/gmail";

const Q = z.object({ name: z.string().max(300).default("piece-jointe"), type: z.string().max(120).default("application/octet-stream") });

export const GET = route({ query: Q }, async ({ db, user, params, query }) => {
  const data = await getAttachment(db, user.id, z.string().max(64).parse(params.id), z.string().max(2000).parse(params.attId));
  const safeType = /^[\w.+-]+\/[\w.+-]+$/.test(query.type) ? query.type : "application/octet-stream";
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": safeType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(query.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
});
