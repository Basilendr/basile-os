import { z } from "zod";
import { route } from "@/lib/api";
import { FileQuery, breadcrumbs, createFolder, listFiles } from "@/services/files";

export const GET = route({ query: FileQuery }, async ({ db, user, query }) => ({
  items: await listFiles(db, user.id, query),
  path: query.parentId && query.parentId !== "root" ? await breadcrumbs(db, user.id, query.parentId) : [],
}));

export const POST = route({ body: z.object({ name: z.string().min(1).max(240), parentId: z.uuid().nullable().default(null) }) }, async ({ db, user, body }) =>
  createFolder(db, user.id, body.name, body.parentId),
);
