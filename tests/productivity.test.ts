import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { setup } from "./helpers";
import { createTask, updateTask, listTasks, taskCounts, getTask, addSubtask, deleteTask } from "@/services/tasks";
import { createProject, getProject, listProjects } from "@/services/projects";
import { createNote, updateNote, listVersions } from "@/services/notes";
import { universalSearch } from "@/services/search";
import { createOwner } from "@/services/account";
import { isoDate, addDays } from "@/lib/utils";

let db: DB;
let userId: string;

beforeAll(async () => {
  ({ db, userId } = await setup());
});

describe("compte", () => {
  it("initialise widgets et agents, refuse un second propriétaire", async () => {
    const widgets = await db.select().from(schema.dashboardWidgets).where(eq(schema.dashboardWidgets.userId, userId));
    const agents = await db.select().from(schema.agents).where(eq(schema.agents.userId, userId));
    expect(widgets.length).toBeGreaterThan(3);
    expect(agents.map((a) => a.key).sort()).toEqual(["calendar", "email", "personal", "productivity", "projects", "research"]);
    expect(agents.every((a) => !a.permissions.includes("envoyer_email"))).toBe(true);
    await expect(createOwner(db, { email: "x@y.test", password: "0123456789", displayName: "X" })).rejects.toThrow(/existe déjà/);
  });
});

describe("tâches & projets", () => {
  it("crée, complète, compte et calcule l'avancement", async () => {
    const p = await createProject(db, userId, { name: "Site vitrine" });
    const t1 = await createTask(db, userId, { title: "Maquette", projectId: p.id, dueDate: isoDate(), priority: "high", subtasks: ["Accueil", "Contact"] });
    const t2 = await createTask(db, userId, { title: "Tarifs", projectId: p.id, dueDate: isoDate(addDays(new Date(), -2)) });
    await createTask(db, userId, { title: "Sans échéance" });

    const today = await listTasks(db, userId, { view: "today", limit: 100 });
    expect(today.map((t) => t.title).sort()).toEqual(["Maquette", "Tarifs"]);
    expect((await listTasks(db, userId, { view: "overdue", limit: 100 })).map((t) => t.title)).toEqual(["Tarifs"]);

    const full = await getTask(db, userId, t1.id);
    expect(full.subtasks.map((s) => s.title)).toEqual(["Accueil", "Contact"]);
    await addSubtask(db, userId, t1.id, "Mentions légales");

    const done = await updateTask(db, userId, t1.id, { status: "done" });
    expect(done.completedAt).toBeTruthy();
    const counts = await taskCounts(db, userId);
    expect(counts.doneToday).toBe(1);
    expect(counts.overdue).toBe(1);

    await updateTask(db, userId, t2.id, { dueDate: isoDate(addDays(new Date(), 3)) });
    expect((await getTask(db, userId, t2.id)).postponedCount).toBe(1);

    const [proj] = await listProjects(db, userId);
    expect(proj.progress).toBe(50);
    const detail = await getProject(db, userId, p.id);
    expect(detail.stats).toMatchObject({ total: 2, done: 1, remaining: 1 });
    expect(detail.progressSeries).toHaveLength(12);
    expect(detail.activity.length).toBeGreaterThan(0);

    const activity = await db.select().from(schema.activityLogs).where(eq(schema.activityLogs.userId, userId));
    expect(activity.some((a) => a.type === "task.completed")).toBe(true);
  });

  it("isole les données par utilisateur", async () => {
    const [other] = await db.insert(schema.users).values({ email: "other@basile-os.test", passwordHash: "x" }).returning();
    const t = await createTask(db, userId, { title: "Privée" });
    await expect(getTask(db, other.id, t.id)).rejects.toThrow(/introuvable/);
    await expect(updateTask(db, other.id, t.id, { title: "piratée" })).rejects.toThrow(/introuvable/);
    await expect(deleteTask(db, other.id, t.id)).rejects.toThrow(/introuvable/);
    await expect(createTask(db, other.id, { title: "x", projectId: (await listProjects(db, userId))[0].id })).rejects.toThrow(/Projet introuvable/);
    expect(await universalSearch(db, other.id, "Privée")).toEqual([]);
  });

  it("refuse des données invalides", async () => {
    await expect(createTask(db, userId, { title: "" })).rejects.toThrow();
    await expect(createTask(db, userId, { title: "x", dueDate: "02/11/2026" })).rejects.toThrow();
  });
});

describe("notes", () => {
  it("versionne, détecte les conflits et reste cherchable sans accents", async () => {
    const n = await createNote(db, userId, { title: "Idées", contentText: "Revoir les tarifs du site été" });
    const u1 = await updateNote(db, userId, n.id, { title: "Idées 2", contentText: "v2", baseRevision: n.revision });
    expect(u1.revision).toBe(2);
    expect((await listVersions(db, userId, n.id)).length).toBe(1);
    await expect(updateNote(db, userId, n.id, { title: "vieux", baseRevision: 1 })).rejects.toThrow(/modifiée ailleurs/);
    const hits = await universalSearch(db, userId, "idees");
    expect(hits.some((h) => h.type === "note" && h.id === n.id)).toBe(true);
  });
});

describe("vue d'ensemble", () => {
  it("agrège les données réelles sans erreur SQL", async () => {
    const { dashboard } = await import("@/services/dashboard");
    const { startOfDay, addDays: add } = await import("@/lib/utils");
    const d = await dashboard(db, userId, { from: startOfDay(), to: add(startOfDay(), 1) });
    expect(d.stats.unreadEmails).toBeNull(); // Gmail non connecté : jamais de faux chiffre
    expect(d.connections).toEqual({ gmail: false, calendar: false });
    expect(d.context).toMatch(/Ta journée|Aucun/);
    expect(d.widgets.length).toBeGreaterThan(0);
  });
});

describe("politiques RLS", () => {
  it("le script RLS s'applique sans erreur sur le schéma migré", async () => {
    const fs = await import("node:fs");
    const { sql } = await import("drizzle-orm");
    await (db as unknown as { $client: { exec: (q: string) => Promise<unknown> } }).$client.exec(fs.readFileSync("database/rls.sql", "utf8"));
    const r = (await db.execute(sql`select count(*)::int as n from pg_policies where policyname = 'owner_isolation'`)) as unknown as { rows: { n: number }[] };
    expect(r.rows[0].n).toBeGreaterThan(30);
  });
});
