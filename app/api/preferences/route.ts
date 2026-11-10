import { z } from "zod";
import { eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";

const Body = z
  .object({
    theme: z.enum(["dark", "light", "system"]),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    density: z.enum(["comfortable", "compact"]),
    sidebarCollapsed: z.boolean(),
    aiProvider: z.enum(["anthropic", "openai", "gemini"]),
    aiModel: z.string().min(1).max(80),
    memoryEnabled: z.boolean(),
    memoryCategories: z.array(z.enum(["preference", "project", "decision", "goal", "method"])),
    toolPermissions: z.record(z.string(), z.enum(["allow", "confirm", "deny"])),
    notificationPrefs: z.record(z.string(), z.boolean()),
  })
  .partial();

export const GET = route({}, async ({ db, user }) => {
  const [p] = await db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, user.id));
  return p;
});

export const PATCH = route({ body: Body }, async ({ db, user, body }) => {
  const [p] = await db.update(schema.userPreferences).set(body).where(eq(schema.userPreferences.userId, user.id)).returning();
  return p;
});
