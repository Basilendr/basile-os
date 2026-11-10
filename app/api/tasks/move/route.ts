import { z } from "zod";
import { route } from "@/lib/api";
import { TaskStatusZ, moveTasks } from "@/services/tasks";

const Body = z.object({ moves: z.array(z.object({ id: z.uuid(), status: TaskStatusZ.optional(), position: z.number() })).min(1).max(200) });

export const POST = route({ body: Body }, async ({ db, user, body }) => {
  await moveTasks(db, user.id, body.moves);
  return { ok: true };
});
