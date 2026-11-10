import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import type { AutomationAction, AutomationCondition } from "@/database/schema";
import { log } from "@/lib/log";
import { isoDate, addDays } from "@/lib/utils";
import { subscribe, type AppEvent } from "../events";
import { registerJob } from "../scheduler";
import { notify } from "../notifications";
import { logActivity } from "../activity";
import { TRIGGERS, ACTIONS } from "./catalog";

type Automation = typeof schema.automations.$inferSelect;
type Run = typeof schema.automationRuns.$inferSelect;
const MAX_ATTEMPTS = 3;

/* ---------------------------------------------------------------- évaluation */

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function matches(conditions: AutomationCondition[], ctx: Record<string, unknown>) {
  return conditions.every((c) => {
    const v = get(ctx, c.field);
    const s = (x: unknown) => String(x ?? "").toLowerCase();
    switch (c.op) {
      case "eq":
        return s(v) === s(c.value);
      case "neq":
        return s(v) !== s(c.value);
      case "contains":
        return Array.isArray(v) ? v.map(s).includes(s(c.value)) : s(v).includes(s(c.value));
      case "gt":
        return Number(v) > Number(c.value);
      case "lt":
        return Number(v) < Number(c.value);
      case "in":
        return String(c.value).split(",").map((x) => x.trim().toLowerCase()).includes(s(v));
    }
  });
}

/** Gabarits {{data.subject}} — remplacement textuel uniquement (jamais d'évaluation de code). */
export function render(tpl: unknown, ctx: Record<string, unknown>): string {
  return String(tpl ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => String(get(ctx, p) ?? "")).slice(0, 2000);
}

/* ---------------------------------------------------------------- actions */

async function runAction(db: DB, a: Automation, action: AutomationAction, ctx: Record<string, unknown>): Promise<Record<string, unknown>> {
  const userId = a.userId;
  const c = action.config ?? {};
  switch (action.type) {
    case "notify": {
      const n = await notify(db, userId, {
        type: "automation",
        title: render(c.title || `Automatisation « ${a.name} »`, ctx),
        body: render(c.body, ctx),
        href: render(c.href, ctx) || (ctx.href as string) || "/automations",
        importance: c.importance === "high" ? "high" : "normal",
        dedupeKey: `auto:${a.id}:${ctx.key}:${action.type}`,
      });
      return { notification: n?.id ?? "ignorée (préférences ou doublon)" };
    }
    case "create_task": {
      const { createTask } = await import("../tasks");
      const days = Number(c.dueInDays);
      const t = await createTask(db, userId, {
        title: render(c.title || "{{data.title}}", ctx) || `Tâche — ${a.name}`,
        description: render(c.description, ctx),
        priority: (["low", "medium", "high", "urgent"].includes(String(c.priority)) ? c.priority : "medium") as "medium",
        dueDate: Number.isFinite(days) && c.dueInDays !== "" && c.dueInDays !== undefined ? isoDate(addDays(new Date(), days)) : null,
        projectId: (c.projectId as string) || ((ctx.data as Record<string, unknown>)?.projectId as string) || null,
        sourceType: "automation",
        sourceId: a.id,
      });
      return { taskId: t.id };
    }
    case "propose_task": {
      // proposition soumise à validation explicite (aucune création silencieuse)
      const title = render(c.title || "Traiter : {{data.subject}}", ctx);
      const [p] = await db
        .insert(schema.aiPendingActions)
        .values({ userId, tool: "creer_tache", args: { title, description: render(c.description || "{{data.snippet}}", ctx), sourceType: ctx.entityType === "email" ? "email" : "automation", sourceId: String(ctx.entityId ?? a.id) }, summary: `Créer la tâche « ${title} »`, agentKey: "automation" })
        .returning();
      await notify(db, userId, { type: "automation", title: `Tâche proposée : ${title}`, body: "Valide ou refuse la proposition.", href: `/command?pending=${p.id}`, importance: "normal", dedupeKey: `auto:${a.id}:${ctx.key}:propose` });
      return { pendingActionId: p.id };
    }
    case "event_checklist": {
      const { createTask } = await import("../tasks");
      const d = ctx.data as Record<string, unknown>;
      const items = String(c.items || "Relire l'ordre du jour\nPréparer les documents\nNoter les questions").split("\n").map((s) => s.trim()).filter(Boolean);
      const start = d?.startAt ? new Date(String(d.startAt)) : null;
      const t = await createTask(db, userId, { title: `Préparer : ${d?.title ?? "rendez-vous"}`, dueDate: start ? isoDate(start) : null, subtasks: items, sourceType: "event", sourceId: String(ctx.entityId ?? "") });
      return { taskId: t.id, items: items.length };
    }
    case "project_progress": {
      const pid = (ctx.data as Record<string, unknown>)?.projectId as string | undefined;
      if (!pid) return { skipped: "tâche sans projet" };
      const [r] = await db
        .select({ name: schema.projects.name, total: sql<number>`count(${schema.tasks.id})::int`, done: sql<number>`count(${schema.tasks.id}) filter (where ${schema.tasks.status}='done')::int` })
        .from(schema.projects)
        .leftJoin(schema.tasks, eq(schema.tasks.projectId, schema.projects.id))
        .where(and(eq(schema.projects.id, pid), eq(schema.projects.userId, userId)))
        .groupBy(schema.projects.id);
      if (!r) return { skipped: "projet introuvable" };
      const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
      await notify(db, userId, { type: "project", title: `${r.name} : ${pct} % terminé`, body: `${r.done}/${r.total} tâches terminées`, href: `/projects/${pid}`, dedupeKey: `auto:${a.id}:${ctx.key}:progress` });
      if (pct === 100 && c.autoComplete) await db.update(schema.projects).set({ status: "completed" }).where(eq(schema.projects.id, pid));
      return { progress: pct };
    }
    case "find_related_docs": {
      const { universalSearch } = await import("../search");
      const d = ctx.data as Record<string, unknown>;
      const q = String(d?.title ?? d?.subject ?? "").split(/\s+/).filter((w) => w.length > 3).slice(0, 3).join(" ");
      if (!q) return { found: 0 };
      const hits = (await universalSearch(db, userId, q, { types: ["note", "file", "knowledge"], limit: 5 })).slice(0, 8);
      for (const h of hits)
        await db
          .insert(schema.knowledgeRelationships)
          .values({ userId, fromType: String(ctx.entityType), fromId: String(ctx.entityId), toType: h.type, toId: h.id, relation: "related" })
          .onConflictDoNothing();
      if (hits.length) await notify(db, userId, { type: "automation", title: `${hits.length} document${hits.length > 1 ? "s" : ""} lié${hits.length > 1 ? "s" : ""} à « ${d?.title ?? d?.subject} »`, body: hits.map((h) => h.title).slice(0, 3).join(" · "), href: String(ctx.href ?? "/brain"), dedupeKey: `auto:${a.id}:${ctx.key}:docs` });
      return { found: hits.length };
    }
    case "project_structure": {
      const pid = String(ctx.entityId);
      const steps = String(c.items || "Cadrage\nConception\nRéalisation\nLivraison").split("\n").map((s) => s.trim()).filter(Boolean);
      const { addMilestone } = await import("../projects");
      for (const s of steps) await addMilestone(db, userId, pid, { title: s });
      return { milestones: steps.length };
    }
    case "generate_briefing": {
      const { generateBriefing } = await import("../ai/briefing");
      const b = await generateBriefing(db, userId, "morning");
      await notify(db, userId, { type: "automation", title: "Briefing du jour prêt", href: "/", dedupeKey: `auto:${a.id}:${ctx.key}:briefing` });
      return { briefingId: b.id };
    }
    case "send_email": {
      // communication externe : toujours soumise à confirmation explicite
      const [p] = await db
        .insert(schema.aiPendingActions)
        .values({ userId, tool: "envoyer_email", args: { to: [render(c.to, ctx)], subject: render(c.subject, ctx), body: render(c.body, ctx) }, summary: `Envoyer un email à ${render(c.to, ctx)}`, agentKey: "automation" })
        .returning();
      await notify(db, userId, { type: "automation", title: "Email en attente de validation", body: render(c.subject, ctx), href: `/command?pending=${p.id}`, importance: "high", dedupeKey: `auto:${a.id}:${ctx.key}:email` });
      return { pendingActionId: p.id };
    }
    default:
      throw new Error(`Action inconnue : ${action.type}`);
  }
}

/* ---------------------------------------------------------------- exécution */

/**
 * Exécute une automatisation pour un événement. L'unicité (automation_id, dedupe_key)
 * garantit qu'un même événement ne déclenche jamais deux exécutions.
 */
export async function execute(db: DB, a: Automation, e: { type: string; key: string; entityType?: string; entityId?: string; data: Record<string, unknown>; href?: string }, attempt = 1, existingRunId?: string): Promise<Run | null> {
  const ctx: Record<string, unknown> = { ...e, data: e.data, now: new Date().toISOString(), today: isoDate() };
  let run: Run | undefined;
  if (existingRunId) {
    [run] = await db.update(schema.automationRuns).set({ status: "running", attempt, error: null, startedAt: new Date() }).where(eq(schema.automationRuns.id, existingRunId)).returning();
  } else {
    [run] = await db
      .insert(schema.automationRuns)
      .values({ userId: a.userId, automationId: a.id, triggerType: e.type, dedupeKey: e.key, status: "running", attempt, input: { entityType: e.entityType, entityId: e.entityId, data: e.data } })
      .onConflictDoNothing()
      .returning();
    if (!run) return null; // déjà exécutée pour cet événement
  }
  const started = Date.now();
  if (!matches(a.conditions, ctx)) {
    const [r] = await db.update(schema.automationRuns).set({ status: "skipped", finishedAt: new Date(), durationMs: Date.now() - started, result: { reason: "conditions non remplies" } }).where(eq(schema.automationRuns.id, run.id)).returning();
    return r;
  }
  const results: Record<string, unknown>[] = [];
  try {
    for (const action of a.actions) results.push({ action: action.type, ...(await runAction(db, a, action, ctx)) });
    const [r] = await db.update(schema.automationRuns).set({ status: "success", finishedAt: new Date(), durationMs: Date.now() - started, result: { actions: results } }).where(eq(schema.automationRuns.id, run.id)).returning();
    await db.update(schema.automations).set({ lastRunAt: new Date() }).where(eq(schema.automations.id, a.id));
    await logActivity(db, a.userId, { type: "automation.run", title: `Automatisation exécutée : ${a.name}`, entityType: "automation", entityId: a.id, meta: { trigger: e.type } });
    return r;
  } catch (err) {
    const message = (err as Error).message.slice(0, 1000);
    const retry = attempt < MAX_ATTEMPTS;
    const [r] = await db
      .update(schema.automationRuns)
      .set({ status: "failed", finishedAt: new Date(), durationMs: Date.now() - started, error: message, result: { actions: results, willRetry: retry } })
      .where(eq(schema.automationRuns.id, run.id))
      .returning();
    log.warn("automation.failed", { automationId: a.id, attempt, error: message });
    if (retry) {
      // nouvelle tentative contrôlée avec délai exponentiel (30 s, 2 min)
      setTimeout(() => void execute(db, a, e, attempt + 1, run!.id).catch(() => null), 30_000 * 4 ** (attempt - 1));
    } else {
      await notify(db, a.userId, { type: "automation", title: `Échec de l'automatisation « ${a.name} »`, body: message, href: `/automations?id=${a.id}`, importance: "high", dedupeKey: `auto-fail:${run.id}` });
    }
    return r;
  }
}

/** Événements métier → automatisations activées correspondantes. */
async function onEvent(db: DB, e: AppEvent) {
  const types = [e.type];
  if (e.type === "email.received" && e.data.important) types.push("email.important");
  const autos = await db.select().from(schema.automations).where(and(eq(schema.automations.userId, e.userId), eq(schema.automations.enabled, true)));
  for (const a of autos) {
    if (!types.includes(a.trigger.type)) continue;
    const href = e.entityType === "email" ? `/inbox?message=${e.entityId}` : e.entityType === "event" ? `/calendar?event=${e.entityId}` : e.entityType === "task" ? `/tasks?task=${e.entityId}` : e.entityType === "project" ? `/projects/${e.entityId}` : undefined;
    await execute(db, a, { ...e, type: a.trigger.type, href });
  }
}

const g = globalThis as unknown as { __basileEngine?: boolean };
if (!g.__basileEngine) {
  g.__basileEngine = true;
  subscribe(onEvent);
  registerJob({
    name: "automations-schedule",
    everyMs: 30_000,
    async run(db) {
      const autos = await db.select().from(schema.automations).where(and(eq(schema.automations.enabled, true), sql`${schema.automations.trigger}->>'type' = 'schedule.daily'`));
      const now = new Date();
      for (const a of autos) {
        const tz = String(a.trigger.config?.timezone ?? "Europe/Paris");
        const [hh, mm] = String(a.trigger.config?.time ?? "08:00").split(":").map(Number);
        const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
        const due = local.getHours() > hh || (local.getHours() === hh && local.getMinutes() >= mm);
        if (!due) continue;
        const day = `${local.getFullYear()}-${local.getMonth() + 1}-${local.getDate()}`;
        await execute(db, a, { type: "schedule.daily", key: `schedule:${day}`, data: { date: day } });
      }
    },
  });
}

export { TRIGGERS, ACTIONS };
