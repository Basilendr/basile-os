import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { setup } from "./helpers";
import { execute, matches, render } from "@/services/automations/engine";
import { emit } from "@/services/events";
import { createTask, updateTask } from "@/services/tasks";
import { createProject } from "@/services/projects";

let db: DB;
let userId: string;

beforeAll(async () => {
  ({ db, userId } = await setup());
});

describe("moteur d'automatisation", () => {
  it("évalue conditions et gabarits sans exécuter de code", () => {
    expect(matches([{ field: "data.subject", op: "contains", value: "facture" }], { data: { subject: "Votre FACTURE" } })).toBe(true);
    expect(matches([{ field: "data.priority", op: "in", value: "high, urgent" }], { data: { priority: "low" } })).toBe(false);
    expect(render("Hello {{data.name}} {{constructor}}", { data: { name: "Basile" } })).toBe("Hello Basile ");
  });

  it("déclenché par un événement métier, sans double exécution", async () => {
    const [a] = await db
      .insert(schema.automations)
      .values({ userId, name: "Tâche terminée → projet", enabled: true, trigger: { type: "task.completed", config: {} }, actions: [{ type: "project_progress", config: {} }] })
      .returning();
    const p = await createProject(db, userId, { name: "Démo" });
    const t = await createTask(db, userId, { title: "Étape 1", projectId: p.id });
    await updateTask(db, userId, t.id, { status: "done" });
    const runs = await db.select().from(schema.automationRuns).where(eq(schema.automationRuns.automationId, a.id));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("success");
    // ré-émission du même événement : ignorée (idempotence)
    const done = await db.select().from(schema.tasks).where(eq(schema.tasks.id, t.id));
    await emit(db, { type: "task.completed", userId, entityType: "task", entityId: t.id, data: done[0], key: `task.completed:${t.id}:${done[0].completedAt?.getTime()}` });
    expect(await db.select().from(schema.automationRuns).where(eq(schema.automationRuns.automationId, a.id))).toHaveLength(1);
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
    expect(notes.some((n) => n.title.includes("100 %"))).toBe(true);
  });

  it("les actions externes produisent une demande de validation, jamais un envoi", async () => {
    const [a] = await db
      .insert(schema.automations)
      .values({ userId, name: "Email", enabled: true, trigger: { type: "manual", config: {} }, actions: [{ type: "send_email", config: { to: "x@y.test", subject: "Bonjour", body: "Test" } }] })
      .returning();
    const r = await execute(db, a, { type: "manual", key: "manual:1", data: {} });
    expect(r?.status).toBe("success");
    const pending = await db.select().from(schema.aiPendingActions).where(eq(schema.aiPendingActions.userId, userId));
    expect(pending.find((p) => p.tool === "envoyer_email")?.status).toBe("pending");
  });

  it("consigne l'échec et ignore si les conditions ne sont pas remplies", async () => {
    const [a] = await db
      .insert(schema.automations)
      .values({ userId, name: "Cond", enabled: true, trigger: { type: "manual", config: {} }, conditions: [{ field: "data.x", op: "eq", value: "1" }], actions: [{ type: "notify", config: { title: "ok" } }] })
      .returning();
    expect((await execute(db, a, { type: "manual", key: "k1", data: { x: "2" } }))?.status).toBe("skipped");
    const [b] = await db.insert(schema.automations).values({ userId, name: "Boom", enabled: true, trigger: { type: "manual", config: {} }, actions: [{ type: "inexistante", config: {} }] }).returning();
    const r = await execute(db, b, { type: "manual", key: "k2", data: {} }, 3);
    expect(r?.status).toBe("failed");
    expect(r?.error).toMatch(/Action inconnue/);
  });
});
