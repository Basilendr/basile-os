import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { parseIsoDate, isoDate } from "@/lib/utils";
import { listEvents, createEvent } from "../calendar";
import { aiSettings, integrationsState } from "./context";
import { completeJson } from "./provider";
import { recordUsage } from "./usage";

type Block = { id: string; start: string; end: string; title: string; kind: string; taskId?: string; accepted?: boolean; eventId?: string };
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Fenêtres libres réelles (minutes depuis minuit) dans la plage de travail. */
async function freeWindows(db: DB, userId: string, date: string, dayStart = 8 * 60, dayEnd = 19 * 60) {
  const d0 = parseIsoDate(date);
  const d1 = new Date(d0.getTime() + 86400_000);
  const events = (await listEvents(db, userId, d0, d1)).filter((e) => !e.allDay);
  const busy = events.map((e) => [Math.max(dayStart, (e.startAt.getTime() - d0.getTime()) / 60000), Math.min(dayEnd, (e.endAt.getTime() - d0.getTime()) / 60000)] as const).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const now = new Date();
  let cursor = date === isoDate(now) ? Math.max(dayStart, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15) : dayStart;
  const free: [number, number][] = [];
  for (const [a, b] of busy) {
    if (a > cursor) free.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < dayEnd) free.push([cursor, dayEnd]);
  return { free: free.filter(([a, b]) => b - a >= 15), events };
}

const PlanZ = z.object({
  rationale: z.string(),
  blocks: z.array(z.object({ start: z.string().describe("HH:mm"), end: z.string().describe("HH:mm"), title: z.string(), kind: z.enum(["task", "email", "project", "break", "focus"]), taskId: z.string().nullable() })),
});

/** Propose un planning qui respecte strictement les disponibilités réelles. Rien n'est écrit dans le calendrier. */
export async function generatePlan(db: DB, userId: string, date: string) {
  const { free, events } = await freeWindows(db, userId, date);
  const tasks = await db
    .select({ id: schema.tasks.id, title: schema.tasks.title, priority: schema.tasks.priority, dueDate: schema.tasks.dueDate, project: schema.projects.name })
    .from(schema.tasks)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .where(and(eq(schema.tasks.userId, userId), ne(schema.tasks.status, "done"), sql`(${schema.tasks.dueDate} <= ${date} or ${schema.tasks.priority} in ('urgent','high') or ${schema.tasks.dueDate} is null)`))
    .orderBy(sql`case ${schema.tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, sql`${schema.tasks.dueDate} asc nulls last`)
    .limit(25);
  const st = await integrationsState(db, userId);
  const s = await aiSettings(db, userId);
  let blocks: Block[] = [];
  let rationale = "";
  if (s.configured) {
    const { data, usage } = await completeJson({
      provider: s.provider,
      model: s.model,
      effort: "medium",
      schema: PlanZ,
      system:
        "Tu planifies une journée de travail. Place des blocs UNIQUEMENT dans les fenêtres libres fournies (jamais sur un événement). Priorise urgent > élevé > échéances proches. Blocs de 30 à 120 min, une pause courte toutes les 2 h environ" +
        (st.gmail ? ", et un bloc de traitement des emails." : ".") +
        " Utilise taskId quand le bloc correspond à une tâche fournie. Rationale : 2 phrases en français.",
      prompt: JSON.stringify({ date, freeWindows: free.map(([a, b]) => ({ start: toHm(a), end: toHm(b) })), existingEvents: events.map((e) => ({ title: e.title, start: e.startAt.toISOString(), end: e.endAt.toISOString() })), tasks }),
    });
    await recordUsage(db, userId, usage, "planner");
    rationale = data.rationale;
    blocks = data.blocks.map((b) => ({ id: randomUUID(), start: b.start, end: b.end, title: b.title, kind: b.kind, taskId: b.taskId && tasks.some((t) => t.id === b.taskId) ? b.taskId : undefined }));
  } else {
    // planification déterministe (sans IA) : remplissage glouton des fenêtres libres par priorité
    rationale = "Plan calculé automatiquement sans IA : tâches classées par priorité puis échéance, placées dans tes créneaux libres réels.";
    const queue = [...(st.gmail ? [{ id: undefined as string | undefined, title: "Traitement des emails", kind: "email", dur: 30 }] : []), ...tasks.map((t) => ({ id: t.id as string | undefined, title: t.title, kind: "task", dur: t.priority === "urgent" || t.priority === "high" ? 60 : 45 }))];
    for (const [a, b] of free) {
      let c = a;
      while (queue.length && c + queue[0].dur <= b) {
        const q = queue.shift()!;
        blocks.push({ id: randomUUID(), start: toHm(c), end: toHm(c + q.dur), title: q.title, kind: q.kind, taskId: q.id });
        c += q.dur + 15;
      }
    }
  }
  // validation serveur : rejette tout bloc hors fenêtre libre ou chevauchant un autre
  const valid: Block[] = [];
  for (const b of blocks.sort((x, y) => toMin(x.start) - toMin(y.start))) {
    const s0 = toMin(b.start);
    const e0 = toMin(b.end);
    if (!(e0 > s0) || !free.some(([a, c]) => s0 >= a && e0 <= c)) continue;
    if (valid.some((v) => toMin(v.start) < e0 && toMin(v.end) > s0)) continue;
    valid.push(b);
  }
  const [plan] = await db
    .insert(schema.dailyPlans)
    .values({ userId, date, blocks: valid, rationale, status: "draft" })
    .onConflictDoUpdate({ target: [schema.dailyPlans.userId, schema.dailyPlans.date], set: { blocks: valid, rationale, status: "draft" } })
    .returning();
  return { ...plan, freeWindows: free.map(([a, b]) => ({ start: toHm(a), end: toHm(b) })), aiUsed: s.configured };
}

export async function getPlan(db: DB, userId: string, date: string) {
  const [p] = await db.select().from(schema.dailyPlans).where(and(eq(schema.dailyPlans.userId, userId), eq(schema.dailyPlans.date, date)));
  return p ?? null;
}

export const BlocksZ = z.array(z.object({ id: z.string(), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), title: z.string().min(1).max(300), kind: z.string().max(20), taskId: z.string().optional(), accepted: z.boolean().optional(), eventId: z.string().optional() })).max(40);

export async function savePlan(db: DB, userId: string, date: string, patch: { blocks?: z.infer<typeof BlocksZ>; status?: "draft" | "accepted" | "rejected" }) {
  const p = await getPlan(db, userId, date);
  if (!p) throw notFound("Planning");
  const [r] = await db.update(schema.dailyPlans).set(patch).where(eq(schema.dailyPlans.id, p.id)).returning();
  return r;
}

/** Crée l'événement d'un bloc — appelé uniquement après confirmation explicite dans l'interface. */
export async function commitBlock(db: DB, userId: string, date: string, blockId: string) {
  const p = await getPlan(db, userId, date);
  if (!p) throw notFound("Planning");
  const b = p.blocks.find((x) => x.id === blockId);
  if (!b) throw notFound("Bloc");
  if (b.eventId) throw new AppError("conflict", "Ce bloc est déjà dans le calendrier.");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const d0 = parseIsoDate(date);
  const start = new Date(d0.getTime() + toMin(b.start) * 60000);
  const end = new Date(d0.getTime() + toMin(b.end) * 60000);
  const ev = await createEvent(db, userId, { title: b.title, startAt: start.toISOString(), endAt: end.toISOString(), timezone: tz, description: "Bloc planifié avec BASILE OS" });
  const blocks = p.blocks.map((x) => (x.id === blockId ? { ...x, accepted: true, eventId: ev.id } : x));
  await db.update(schema.dailyPlans).set({ blocks }).where(eq(schema.dailyPlans.id, p.id));
  return { eventId: ev.id, source: ev.source };
}
