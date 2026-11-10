import { z } from "zod";
import { route, zId } from "@/lib/api";
import { getVersion, restoreVersion } from "@/services/notes";

export const GET = route({}, async ({ db, user, params }) => getVersion(db, user.id, zId.parse(params.versionId)));
export const POST = route({ body: z.object({ contentText: z.string().max(500_000) }) }, async ({ db, user, params, body }) =>
  restoreVersion(db, user.id, zId.parse(params.id), zId.parse(params.versionId), body.contentText),
);
