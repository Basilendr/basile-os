import { z } from "zod";
import { route, zDate } from "@/lib/api";
import { HomeworkInput, addHomework, listHomework } from "@/services/school/school";

const Q = z.object({ from: zDate.optional(), to: zDate.optional(), kind: z.enum(["all", "homework", "test"]).default("all"), done: z.enum(["0", "1"]).optional() });

export const GET = route({ query: Q }, async ({ db, user, query }) => ({ items: await listHomework(db, user.id, { ...query, done: query.done === undefined ? undefined : query.done === "1" }) }));
export const POST = route({ body: HomeworkInput }, async ({ db, user, body }) => addHomework(db, user.id, body));
