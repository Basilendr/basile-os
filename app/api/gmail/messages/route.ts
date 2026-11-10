import { z } from "zod";
import { route } from "@/lib/api";
import { FOLDERS, listMessages, syncGmail, type Folder } from "@/services/google/gmail";
import { schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

const Q = z.object({
  folder: z.enum(Object.keys(FOLDERS) as [Folder, ...Folder[]]).default("inbox"),
  q: z.string().max(500).optional(),
  pageToken: z.string().max(200).optional(),
});

export const GET = route({ query: Q, rate: [60, 60_000] }, async ({ db, user, query }) => {
  // synchronisation incrémentale opportuniste (au plus toutes les 60 s)
  const [integ] = await db.select({ last: schema.integrations.lastSyncAt }).from(schema.integrations).where(and(eq(schema.integrations.userId, user.id), eq(schema.integrations.service, "gmail")));
  if (!query.pageToken && (!integ?.last || Date.now() - integ.last.getTime() > 60_000)) await syncGmail(db, user.id).catch(() => null);
  return listMessages(db, user.id, query);
});
