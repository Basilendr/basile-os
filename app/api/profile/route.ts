import { z } from "zod";
import { eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";

const Body = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    avatarUrl: z.string().url().max(2000).nullable(),
    locale: z.enum(["fr", "en"]),
    timezone: z.string().max(60).refine((tz) => {
      try {
        new Intl.DateTimeFormat("fr", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Fuseau horaire inconnu"),
    dateFormat: z.enum(["dd/MM/yyyy", "yyyy-MM-dd", "MM/dd/yyyy"]),
    timeFormat: z.enum(["24h", "12h"]),
  })
  .partial();

export const PATCH = route({ body: Body }, async ({ db, user, body }) => {
  const [p] = await db.update(schema.profiles).set(body).where(eq(schema.profiles.userId, user.id)).returning();
  return p;
});
