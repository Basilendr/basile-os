import { z } from "zod";
import { route } from "@/lib/api";
import { drivePath, listDrive } from "@/services/google/drive";

const Q = z.object({ folder: z.string().max(100).optional(), q: z.string().max(200).optional(), view: z.enum(["my", "recent", "shared", "starred"]).optional(), pageToken: z.string().max(500).optional() });

export const GET = route({ query: Q, rate: [60, 60_000] }, async ({ db, user, query }) => ({
  ...(await listDrive(db, user.id, { folderId: query.folder, q: query.q, view: query.view, pageToken: query.pageToken })),
  path: query.folder && query.folder !== "root" ? await drivePath(db, user.id, query.folder) : [],
}));
