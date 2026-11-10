import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { setup } from "./helpers";
import { executeTool, decidePending, availableTools, markdownToDoc, looksSensitive, type Source } from "@/services/ai/tools";
import { strictJsonSchema } from "@/services/ai/provider";
import { generatePlan, commitBlock } from "@/services/ai/planner";
import { streamTurn } from "@/services/ai/chat";
import { createEvent } from "@/services/calendar";
import { isoDate, addDays } from "@/lib/utils";
import { z } from "zod";

let db: DB;
let userId: string;
const ctx = () => ({ db, userId, sources: [] as Source[] });

beforeAll(async () => {
  ({ db, userId } = await setup());
});

describe("outils IA — validation, permissions, confirmations", () => {
  it("valide strictement les paramètres", async () => {
    const r = await executeTool(ctx(), "creer_tache", { title: "" });
    expect(r).toMatchObject({ kind: "result", isError: true });
    const bad = await executeTool(ctx(), "creer_tache", { title: "x", dueDate: "demain" });
    expect(bad).toMatchObject({ isError: true });
  });

  it("exécute les écritures locales autorisées et cite la source", async () => {
    const c = ctx();
    const r = await executeTool(c, "creer_tache", { title: "Rappeler Paul", priority: "high" });
    expect(r.kind).toBe("result");
    expect(c.sources[0]).toMatchObject({ type: "task", title: "Rappeler Paul" });
  });

  it("met en attente les actions externes au lieu de les exécuter", async () => {
    const start = new Date(Date.now() + 86400_000).toISOString();
    const end = new Date(Date.now() + 90000_000).toISOString();
    const r = await executeTool(ctx(), "creer_evenement", { title: "RDV banque", startAt: start, endAt: end });
    expect(r.kind).toBe("pending");
    const events = await db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.userId, userId));
    expect(events).toHaveLength(0); // rien n'a été créé sans validation
    if (r.kind !== "pending") throw new Error();
    const done = await decidePending(db, userId, r.pendingId, true);
    expect(done.status).toBe("executed");
    await expect(decidePending(db, userId, r.pendingId, true)).rejects.toThrow(/déjà été traitée/);
    expect((await db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.userId, userId))).length).toBe(1);
  });

  it("l'envoi d'email reste toujours soumis à confirmation, même si l'utilisateur tente de l'autoriser", async () => {
    await db.update(schema.userPreferences).set({ toolPermissions: { envoyer_email: "allow" } }).where(eq(schema.userPreferences.userId, userId));
    const r = await executeTool(ctx(), "envoyer_email", { to: ["a@b.test"], subject: "x", body: "y" });
    expect(r.kind).toBe("pending");
  });

  it("refuse les outils désactivés et ceux hors permissions d'un agent", async () => {
    await db.update(schema.userPreferences).set({ toolPermissions: { creer_projet: "deny" } }).where(eq(schema.userPreferences.userId, userId));
    expect(await executeTool(ctx(), "creer_projet", { name: "X" })).toMatchObject({ isError: true });
    expect(await executeTool(ctx(), "creer_tache", { title: "X" }, { allowed: ["rechercher_taches"] })).toMatchObject({ isError: true });
    const tools = await availableTools(db, userId);
    expect(tools.find((t) => t.name === "creer_projet")).toBeUndefined();
    expect(tools.find((t) => t.name === "rechercher_emails")).toBeUndefined(); // Gmail non connecté
  });

  it("la mémoire respecte l'activation, les catégories et refuse le sensible", async () => {
    expect(looksSensitive("mon mot de passe est 1234")).toBe(true);
    expect(looksSensitive("Je préfère travailler le matin")).toBe(false);
    const r = await executeTool(ctx(), "enregistrer_memoire", { category: "preference", content: "Préfère les réunions l'après-midi" });
    expect(r.kind).toBe("pending"); // confirmation par défaut
    await db.update(schema.userPreferences).set({ memoryEnabled: false }).where(eq(schema.userPreferences.userId, userId));
    if (r.kind !== "pending") throw new Error();
    const d = await decidePending(db, userId, r.pendingId, true);
    expect(d.status).toBe("failed");
    await db.update(schema.userPreferences).set({ memoryEnabled: true }).where(eq(schema.userPreferences.userId, userId));
  });

  it("refuse une action en attente appartenant à un autre utilisateur", async () => {
    const r = await executeTool(ctx(), "envoyer_email", { to: ["a@b.test"], subject: "x", body: "y" });
    const [other] = await db.insert(schema.users).values({ email: "o@b.test", passwordHash: "x" }).returning();
    if (r.kind !== "pending") throw new Error();
    await expect(decidePending(db, other.id, r.pendingId, true)).rejects.toThrow(/introuvable/);
  });
});

describe("IA non configurée", () => {
  it("le flux de conversation renvoie une erreur explicite (jamais une fausse réponse)", async () => {
    const res = new Response(streamTurn(db, userId, { kind: "assistant", message: "Bonjour" }));
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.at(-1)).toMatchObject({ type: "error", code: "not_configured" });
  });
});

describe("planificateur", () => {
  it("ne place des blocs que dans les créneaux réellement libres", async () => {
    const date = isoDate(addDays(new Date(), 2));
    const d0 = new Date(`${date}T00:00:00`);
    await createEvent(db, userId, { title: "Réunion", startAt: new Date(d0.getTime() + 10 * 3600_000).toISOString(), endAt: new Date(d0.getTime() + 12 * 3600_000).toISOString(), target: "local" });
    const plan = await generatePlan(db, userId, date);
    expect(plan.aiUsed).toBe(false);
    expect(plan.blocks.length).toBeGreaterThan(0);
    for (const b of plan.blocks) expect(b.end <= "10:00" || b.start >= "12:00").toBe(true);
    const r = await commitBlock(db, userId, date, plan.blocks[0].id);
    expect(r.source).toBe("local");
    await expect(commitBlock(db, userId, date, plan.blocks[0].id)).rejects.toThrow(/déjà/);
  });
});

describe("utilitaires", () => {
  it("convertit le Markdown en document éditable", () => {
    const d = markdownToDoc("# Titre\n- un\n- deux\n- [ ] case\ntexte") as { content: { type: string }[] };
    expect(d.content.map((c) => c.type)).toEqual(["heading", "bulletList", "taskList", "paragraph"]);
  });
  it("produit un JSON Schema strict pour les sorties structurées", () => {
    const s = strictJsonSchema(z.object({ a: z.string(), b: z.object({ c: z.number().nullable() }) })) as { additionalProperties: boolean; required: string[] };
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["a", "b"]);
  });
});
