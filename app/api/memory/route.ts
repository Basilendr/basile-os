import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { looksSensitive } from "@/services/ai/tools";

const Cat = z.enum(["preference", "project", "decision", "goal", "method"]);

export const GET = route({}, async ({ db, user }) => ({ items: await db.select().from(schema.aiMemory).where(eq(schema.aiMemory.userId, user.id)).orderBy(desc(schema.aiMemory.updatedAt)) }));

export const POST = route({ body: z.object({ category: Cat, content: z.string().trim().min(3).max(500) }) }, async ({ db, user, body }) => {
  if (looksSensitive(body.content)) throw new AppError("bad_request", "Cette information semble sensible : elle n'est pas mémorisée.");
  const [m] = await db.insert(schema.aiMemory).values({ userId: user.id, ...body, sourceType: "manual" }).returning();
  return m;
});
