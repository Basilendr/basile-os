import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { setup } from "./helpers";
import { createTask } from "@/services/tasks";
import { dashboard } from "@/services/dashboard";
import { addDays, startOfDay } from "@/lib/utils";

let db: DB;
let userId: string;

beforeAll(async () => {
  ({ db, userId } = await setup());
});

describe("vue d'ensemble — tendances", () => {
  it("compare la période à la précédente et fournit la série quotidienne réelle", async () => {
    const now = new Date();
    for (const daysAgo of [0, 1, 9]) {
      const t = await createTask(db, userId, { title: `Tâche ${daysAgo}` });
      await db.update(schema.tasks).set({ status: "done", completedAt: addDays(now, -daysAgo) }).where(eq(schema.tasks.id, t.id));
    }
    const from = startOfDay();
    const d = await dashboard(db, userId, { from, to: addDays(from, 1) }, 7);
    expect(d.trend.days).toBe(7);
    expect(d.trend.tasksDone).toEqual({ cur: 2, prev: 1, delta: 100 });
    expect(d.trend.tasksCreated.cur).toBe(3);
    expect(d.trend.series).toHaveLength(7);
    expect(d.trend.series.reduce((a, x) => a + x.done, 0)).toBe(2);
    // sans activité précédente, pas de pourcentage inventé
    expect(d.trend.events).toEqual({ cur: 0, prev: 0, delta: null });
    expect(d.widgets.some((w) => w.widgetKey === "trend")).toBe(true);
  });
});
