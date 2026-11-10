import { z } from "zod";
import { route, zId } from "@/lib/api";
import { addSubtask } from "@/services/tasks";

export const POST = route({ body: z.object({ title: z.string().trim().min(1).max(300) }) }, async ({ db, user, params, body }) =>
  addSubtask(db, user.id, zId.parse(params.id), body.title),
);
