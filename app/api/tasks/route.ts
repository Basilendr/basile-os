import { route } from "@/lib/api";
import { TaskCreate, TaskQuery, createTask, listTasks, taskCounts } from "@/services/tasks";

export const GET = route({ query: TaskQuery }, async ({ db, user, query }) => ({
  items: await listTasks(db, user.id, query),
  counts: await taskCounts(db, user.id),
}));

export const POST = route({ body: TaskCreate }, async ({ db, user, body }) => createTask(db, user.id, body));
