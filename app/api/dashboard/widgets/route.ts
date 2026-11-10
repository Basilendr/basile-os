import { z } from "zod";
import { route } from "@/lib/api";
import { WIDGETS } from "@/lib/catalog";
import { saveWidgets } from "@/services/dashboard";

const Body = z.object({
  widgets: z
    .array(z.object({ widgetKey: z.enum(Object.keys(WIDGETS) as [string, ...string[]]), position: z.number().int().min(0), size: z.enum(["sm", "md", "lg", "full"]), visible: z.boolean() }))
    .max(20),
});

export const PUT = route({ body: Body }, async ({ db, user, body }) => {
  await saveWidgets(db, user.id, body.widgets);
  return { ok: true };
});
