import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { ALWAYS_CONFIRM, TOOLS, defaultToolPolicy, type ToolName } from "@/lib/catalog";
import { isoDate } from "@/lib/utils";
import { logActivity } from "../activity";
import { toolJsonSchema, type ToolSpec } from "./provider";

/**
 * Outils structurés de l'IA. Chaque outil : validation Zod stricte, exécution
 * toujours scopée à l'utilisateur authentifié, politique d'autorisation
 * (allow / confirm / deny), journalisation, format de sortie JSON défini.
 * Les contenus externes (emails, documents) sont balisés comme données non fiables.
 */

export type Source = { type: string; id: string; title: string; href: string };
export type ToolCtx = { db: DB; userId: string; conversationId?: string | null; agentKey?: string | null; sources: Source[] };
type ToolImpl<S extends z.ZodType> = { schema: S; description: string; run: (ctx: ToolCtx, input: z.infer<S>) => Promise<unknown>; summarize: (input: z.infer<S>) => string };

const untrusted = (source: string, text: string) => `<donnees_non_fiables source="${source}">\n${text.slice(0, 12_000)}\n</donnees_non_fiables>`;
const zIso = z.string().describe("Date/heure ISO 8601 avec fuseau, ex. 2026-11-03T14:00:00+01:00");

function tool<S extends z.ZodType>(t: ToolImpl<S>) {
  return t;
}

export const IMPLS = {
  rechercher_emails: tool({
    description: "Recherche des emails Gmail (syntaxe de recherche Gmail acceptée : from:, subject:, is:unread, newer_than:7d…). Retourne expéditeur, objet, extrait, date.",
    schema: z.object({ query: z.string().max(300).describe("Requête Gmail"), max: z.number().int().min(1).max(25).optional() }),
    summarize: (i) => `Recherche d'emails : « ${i.query} »`,
    async run({ db, userId, sources }, i) {
      const { listMessages } = await import("../google/gmail");
      const r = await listMessages(db, userId, { folder: "all", q: i.query, limit: i.max ?? 10 });
      r.items.forEach((m) => sources.push({ type: "email", id: m.gmailId, title: m.subject || "(sans objet)", href: `/inbox?message=${m.gmailId}` }));
      return {
        emails: r.items.map((m) => ({ id: m.gmailId, threadId: m.threadId, from: `${m.fromName ?? ""} <${m.fromEmail ?? ""}>`, subject: m.subject, snippet: untrusted("email", m.snippet), date: m.internalDate.toISOString(), unread: m.isUnread, important: m.isImportant, starred: m.isStarred })),
      };
    },
  }),
  lire_email: tool({
    description: "Lit le contenu complet d'un email (par identifiant Gmail).",
    schema: z.object({ id: z.string().max(64) }),
    summarize: () => "Lecture d'un email",
    async run({ db, userId, sources }, i) {
      const { getMessage } = await import("../google/gmail");
      const m = await getMessage(db, userId, i.id);
      sources.push({ type: "email", id: m.id, title: m.subject || "(sans objet)", href: `/inbox?message=${m.id}` });
      const body = m.textBody || m.htmlBody.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      return { id: m.id, threadId: m.threadId, from: `${m.fromName ?? ""} <${m.fromEmail ?? ""}>`, to: m.to, cc: m.cc, subject: m.subject, date: m.date, messageId: m.messageIdHeader, body: untrusted("email", body), attachments: m.attachments.map((a) => a.filename) };
    },
  }),
  resumer_email: tool({
    description: "Récupère un fil de discussion complet pour le résumer.",
    schema: z.object({ threadId: z.string().max(64) }),
    summarize: () => "Lecture d'un fil de discussion",
    async run({ db, userId, sources }, i) {
      const { getThread } = await import("../google/gmail");
      const msgs = await getThread(db, userId, i.threadId);
      if (msgs[0]) sources.push({ type: "email", id: msgs[0].id, title: msgs[0].subject ?? "(sans objet)", href: `/inbox?message=${msgs[0].id}` });
      return { messages: msgs.map((m) => ({ from: `${m.fromName ?? ""} <${m.fromEmail ?? ""}>`, date: m.date, body: untrusted("email", m.textBody || m.snippet || "") })) };
    },
  }),
  creer_brouillon_email: tool({
    description: "Crée un brouillon dans Gmail (n'envoie rien).",
    schema: z.object({ to: z.array(z.email()).min(1), cc: z.array(z.email()).optional(), subject: z.string().max(500), body: z.string().max(50_000).describe("Texte brut"), threadId: z.string().max(64).optional(), inReplyTo: z.string().max(1000).optional() }),
    summarize: (i) => `Brouillon à ${i.to.join(", ")} : « ${i.subject} »`,
    async run({ db, userId }, i) {
      const { saveDraft } = await import("../google/gmail");
      const d = await saveDraft(db, userId, { to: i.to, cc: i.cc, subject: i.subject, text: i.body, html: textToHtml(i.body), threadId: i.threadId, inReplyTo: i.inReplyTo });
      return { draftId: d.draftId, status: "brouillon enregistré dans Gmail, non envoyé" };
    },
  }),
  envoyer_email: tool({
    description: "Envoie un email via Gmail. Exige TOUJOURS la confirmation explicite de l'utilisateur.",
    schema: z.object({ to: z.array(z.email()).min(1), cc: z.array(z.email()).optional(), subject: z.string().max(500), body: z.string().max(50_000), threadId: z.string().max(64).optional(), inReplyTo: z.string().max(1000).optional() }),
    summarize: (i) => `Envoyer un email à ${i.to.join(", ")} : « ${i.subject} »`,
    async run({ db, userId }, i) {
      const { sendMessage } = await import("../google/gmail");
      const r = await sendMessage(db, userId, { to: i.to, cc: i.cc, subject: i.subject, text: i.body, html: textToHtml(i.body), threadId: i.threadId, inReplyTo: i.inReplyTo });
      return { sent: true, gmailId: r.id };
    },
  }),
  rechercher_calendrier: tool({
    description: "Liste les événements du calendrier entre deux dates.",
    schema: z.object({ from: zIso, to: zIso }),
    summarize: (i) => `Consultation du calendrier (${i.from.slice(0, 10)} → ${i.to.slice(0, 10)})`,
    async run({ db, userId, sources }, i) {
      const { listEvents } = await import("../calendar");
      const evs = await listEvents(db, userId, new Date(i.from), new Date(i.to));
      evs.forEach((e) => sources.push({ type: "event", id: e.id, title: e.title, href: `/calendar?event=${e.id}` }));
      return { events: evs.map((e) => ({ id: e.id, title: e.title, start: e.startAt.toISOString(), end: e.endAt.toISOString(), allDay: e.allDay, location: e.location, attendees: e.attendees.map((a) => a.email), source: e.source, description: untrusted("calendrier", e.description.slice(0, 500)) })) };
    },
  }),
  trouver_creneaux: tool({
    description: "Trouve des créneaux libres réels d'une durée donnée (tient compte de tous les événements).",
    schema: z.object({ from: zIso, to: zIso, durationMin: z.number().int().min(15).max(600), dayStart: z.number().int().min(0).max(23).optional(), dayEnd: z.number().int().min(1).max(24).optional() }),
    summarize: (i) => `Recherche de créneaux de ${i.durationMin} min`,
    async run({ db, userId }, i) {
      const { findFreeSlots } = await import("../calendar");
      return { slots: await findFreeSlots(db, userId, { from: new Date(i.from), to: new Date(i.to), durationMin: i.durationMin, dayStart: i.dayStart, dayEnd: i.dayEnd }) };
    },
  }),
  creer_evenement: tool({
    description: "Crée un événement dans le calendrier (Google si connecté). Exige la confirmation de l'utilisateur.",
    schema: z.object({ title: z.string().min(1).max(300), startAt: zIso, endAt: zIso, description: z.string().max(5000).optional(), location: z.string().max(500).optional(), attendees: z.array(z.email()).max(50).optional(), projectId: z.uuid().optional() }),
    summarize: (i) => `Créer l'événement « ${i.title} » le ${new Date(i.startAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}`,
    async run({ db, userId, sources }, i) {
      const { createEvent } = await import("../calendar");
      const e = await createEvent(db, userId, { ...i, attendees: (i.attendees ?? []).map((email) => ({ email })) });
      sources.push({ type: "event", id: e.id, title: e.title, href: `/calendar?event=${e.id}` });
      return { eventId: e.id, source: e.source };
    },
  }),
  modifier_evenement: tool({
    description: "Modifie un événement existant. Exige la confirmation de l'utilisateur.",
    schema: z.object({ id: z.uuid(), title: z.string().max(300).optional(), startAt: zIso.optional(), endAt: zIso.optional(), description: z.string().max(5000).optional(), location: z.string().max(500).optional() }),
    summarize: (i) => `Modifier l'événement${i.title ? ` « ${i.title} »` : ""}${i.startAt ? ` → ${new Date(i.startAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}` : ""}`,
    async run({ db, userId }, i) {
      const { updateEvent } = await import("../calendar");
      const { id, ...patch } = i;
      const e = await updateEvent(db, userId, id, patch);
      return { eventId: e.id, updated: Object.keys(patch) };
    },
  }),
  creer_tache: tool({
    description: "Crée une tâche.",
    schema: z.object({
      title: z.string().min(1).max(300),
      description: z.string().max(10_000).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      projectId: z.uuid().optional(),
      subtasks: z.array(z.string().max(300)).max(20).optional(),
      sourceType: z.enum(["email", "note", "event"]).optional(),
      sourceId: z.string().max(200).optional(),
    }),
    summarize: (i) => `Créer la tâche « ${i.title} »`,
    async run({ db, userId, sources }, i) {
      const { createTask } = await import("../tasks");
      const t = await createTask(db, userId, { ...i, sourceType: i.sourceType ?? "ai" });
      sources.push({ type: "task", id: t.id, title: t.title, href: `/tasks?task=${t.id}` });
      return { taskId: t.id };
    },
  }),
  modifier_tache: tool({
    description: "Modifie une tâche (statut, priorité, échéance, titre…).",
    schema: z.object({ id: z.uuid(), title: z.string().max(300).optional(), status: z.enum(["todo", "in_progress", "review", "done"]).optional(), priority: z.enum(["low", "medium", "high", "urgent"]).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), projectId: z.uuid().nullable().optional() }),
    summarize: (i) => `Modifier une tâche (${Object.keys(i).filter((k) => k !== "id").join(", ")})`,
    async run({ db, userId }, i) {
      const { updateTask } = await import("../tasks");
      const { id, ...patch } = i;
      const t = await updateTask(db, userId, id, patch);
      return { taskId: t.id, status: t.status };
    },
  }),
  rechercher_taches: tool({
    description: "Liste les tâches (vues : today, upcoming, all, overdue, done) avec filtre texte optionnel.",
    schema: z.object({ view: z.enum(["today", "upcoming", "all", "overdue", "done"]).optional(), q: z.string().max(200).optional(), projectId: z.uuid().optional() }),
    summarize: (i) => `Consultation des tâches (${i.view ?? "all"})`,
    async run({ db, userId, sources }, i) {
      const { listTasks } = await import("../tasks");
      const items = await listTasks(db, userId, { view: i.view ?? "all", q: i.q, projectId: i.projectId, limit: 60 });
      items.slice(0, 20).forEach((t) => sources.push({ type: "task", id: t.id, title: t.title, href: `/tasks?task=${t.id}` }));
      return { today: isoDate(), tasks: items.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, dueTime: t.dueTime, project: t.projectName, postponed: t.postponedCount, subtasks: `${t.subtaskDone}/${t.subtaskTotal}` })) };
    },
  }),
  creer_projet: tool({
    description: "Crée un projet.",
    schema: z.object({ name: z.string().min(1).max(160), description: z.string().max(5000).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), priority: z.enum(["low", "medium", "high", "urgent"]).optional() }),
    summarize: (i) => `Créer le projet « ${i.name} »`,
    async run({ db, userId, sources }, i) {
      const { createProject } = await import("../projects");
      const p = await createProject(db, userId, i);
      sources.push({ type: "project", id: p.id, title: p.name, href: `/projects/${p.id}` });
      return { projectId: p.id };
    },
  }),
  rechercher_projets: tool({
    description: "Liste les projets avec avancement, retards et prochaines échéances.",
    schema: z.object({ q: z.string().max(200).optional() }),
    summarize: () => "Consultation des projets",
    async run({ db, userId, sources }, i) {
      const { listProjects } = await import("../projects");
      const ps = (await listProjects(db, userId)).filter((p) => !i.q || p.name.toLowerCase().includes(i.q.toLowerCase()));
      ps.forEach((p) => sources.push({ type: "project", id: p.id, title: p.name, href: `/projects/${p.id}` }));
      return { projects: ps.map((p) => ({ id: p.id, name: p.name, status: p.status, priority: p.priority, progress: p.progress, tasks: `${p.taskDone}/${p.taskTotal}`, overdue: p.taskOverdue, dueDate: p.dueDate, nextDue: p.nextDue, description: p.description.slice(0, 300) })) };
    },
  }),
  creer_note: tool({
    description: "Crée une note (contenu en Markdown simple : titres #, listes -, paragraphes).",
    schema: z.object({ title: z.string().min(1).max(300), markdown: z.string().max(100_000), projectId: z.uuid().optional(), tags: z.array(z.string().max(40)).max(10).optional() }),
    summarize: (i) => `Créer la note « ${i.title} »`,
    async run({ db, userId, sources }, i) {
      const { createNote } = await import("../notes");
      const n = await createNote(db, userId, { title: i.title, content: markdownToDoc(i.markdown), contentText: i.markdown, projectId: i.projectId, tags: i.tags ?? [] });
      sources.push({ type: "note", id: n.id, title: n.title, href: `/notes?note=${n.id}` });
      return { noteId: n.id };
    },
  }),
  rechercher_notes: tool({
    description: "Recherche des notes par mots-clés et retourne leur contenu.",
    schema: z.object({ q: z.string().max(200) }),
    summarize: (i) => `Recherche de notes : « ${i.q} »`,
    async run({ db, userId, sources }, i) {
      const rows = await db
        .select({ id: schema.notes.id, title: schema.notes.title, text: schema.notes.contentText, updatedAt: schema.notes.updatedAt })
        .from(schema.notes)
        .where(eq(schema.notes.userId, userId))
        .orderBy(desc(schema.notes.updatedAt))
        .limit(300);
      const terms = i.q.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/\s+/).filter(Boolean);
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
      const hits = rows.filter((n) => terms.some((t) => norm(n.title + " " + n.text).includes(t))).slice(0, 8);
      hits.forEach((n) => sources.push({ type: "note", id: n.id, title: n.title, href: `/notes?note=${n.id}` }));
      return { notes: hits.map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt.toISOString(), content: untrusted("note", n.text.slice(0, 3000)) })) };
    },
  }),
  rechercher_fichiers: tool({
    description: "Recherche des fichiers par nom ou contenu extrait.",
    schema: z.object({ q: z.string().max(200) }),
    summarize: (i) => `Recherche de fichiers : « ${i.q} »`,
    async run({ db, userId, sources }, i) {
      const { listFiles } = await import("../files");
      const fs = (await listFiles(db, userId, { q: i.q, sort: "updated" })).filter((f) => !f.isFolder).slice(0, 10);
      fs.forEach((f) => sources.push({ type: "file", id: f.id, title: f.name, href: `/files?file=${f.id}` }));
      return { files: fs.map((f) => ({ id: f.id, name: f.name, type: f.kind, size: f.size, hasText: f.hasText, projectId: f.projectId })) };
    },
  }),
  resumer_document: tool({
    description: "Lit le texte extrait d'un document (PDF, DOCX, texte) pour le résumer ou répondre à une question.",
    schema: z.object({ fileId: z.uuid() }),
    summarize: () => "Lecture d'un document",
    async run({ db, userId, sources }, i) {
      const { getFile } = await import("../files");
      const f = await getFile(db, userId, i.fileId);
      sources.push({ type: "file", id: f.id, title: f.name, href: `/files?file=${f.id}` });
      if (!f.textContent) return { name: f.name, error: "Aucun texte extractible pour ce fichier (image ou format non pris en charge)." };
      return { name: f.name, content: untrusted("document", f.textContent.slice(0, 40_000)), truncated: f.textContent.length > 40_000 };
    },
  }),
  recherche_semantique: tool({
    description: "Recherche par le sens dans notes, documents, projets et Second Brain (embeddings).",
    schema: z.object({ query: z.string().max(500) }),
    summarize: (i) => `Recherche sémantique : « ${i.query} »`,
    async run({ db, userId, sources }, i) {
      const { semanticSearch } = await import("./embeddings");
      const { resolveEntities } = await import("../brain");
      const hits = await semanticSearch(db, userId, i.query, { limit: 8 });
      const resolved = await resolveEntities(db, userId, hits.map((h) => ({ type: h.entityType, id: h.entityId })));
      return {
        results: hits.map((h) => {
          const r = resolved.get(`${h.entityType}:${h.entityId}`);
          if (r) sources.push(r);
          return { type: h.entityType, id: h.entityId, title: r?.title ?? h.entityId, score: Math.round(h.score * 100) / 100, excerpt: untrusted(h.entityType, h.content.slice(0, 800)) };
        }),
      };
    },
  }),
  creer_rappel: tool({
    description: "Crée un rappel (tâche avec notification à l'heure indiquée).",
    schema: z.object({ title: z.string().min(1).max(300), at: zIso }),
    summarize: (i) => `Rappel « ${i.title} » le ${new Date(i.at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}`,
    async run({ db, userId, sources }, i) {
      const { createTask } = await import("../tasks");
      const d = new Date(i.at);
      const t = await createTask(db, userId, { title: i.title, reminderAt: d.toISOString(), dueDate: isoDate(d), sourceType: "ai" });
      sources.push({ type: "task", id: t.id, title: t.title, href: `/tasks?task=${t.id}` });
      return { taskId: t.id, reminderAt: d.toISOString() };
    },
  }),
  generer_briefing_quotidien: tool({
    description: "Rassemble les données réelles du jour (agenda, tâches, échéances, emails importants, projets) pour préparer un briefing.",
    schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    summarize: () => "Collecte des données du jour",
    async run({ db, userId, sources }, i) {
      const { gatherContext } = await import("./briefing");
      const c = await gatherContext(db, userId, i.date);
      sources.push(...c.sources);
      return c.data;
    },
  }),
  consulter_memoire: tool({
    description: "Consulte la mémoire contrôlée par l'utilisateur (préférences, contexte de projets, décisions, objectifs, méthodes).",
    schema: z.object({ category: z.enum(["preference", "project", "decision", "goal", "method"]).optional() }),
    summarize: () => "Consultation de la mémoire",
    async run({ db, userId }, i) {
      const [p] = await db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId));
      if (!p?.memoryEnabled) return { disabled: true, memories: [] };
      const where = [eq(schema.aiMemory.userId, userId)];
      if (i.category) where.push(eq(schema.aiMemory.category, i.category));
      const rows = await db.select().from(schema.aiMemory).where(and(...where)).orderBy(desc(schema.aiMemory.updatedAt)).limit(50);
      return { memories: rows.map((m) => ({ category: m.category, content: m.content })) };
    },
  }),
  enregistrer_memoire: tool({
    description: "Propose d'enregistrer un fait durable utile (préférence, décision, objectif, méthode, contexte de projet). Jamais d'information sensible (santé, finances, identifiants, données de tiers).",
    schema: z.object({ category: z.enum(["preference", "project", "decision", "goal", "method"]), content: z.string().min(3).max(500) }),
    summarize: (i) => `Mémoriser : « ${i.content} »`,
    async run({ db, userId, conversationId }, i) {
      const [p] = await db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId));
      if (!p?.memoryEnabled) throw new AppError("forbidden", "La mémoire est désactivée par l'utilisateur.");
      if (!p.memoryCategories.includes(i.category)) throw new AppError("forbidden", `La catégorie « ${i.category} » n'est pas autorisée à la mémorisation.`);
      if (looksSensitive(i.content)) throw new AppError("forbidden", "Information potentiellement sensible : non mémorisée.");
      const [m] = await db.insert(schema.aiMemory).values({ userId, category: i.category, content: i.content, sourceType: conversationId ? "conversation" : "manual", sourceId: conversationId ?? null }).returning();
      return { memoryId: m.id };
    },
  }),
  deleguer_agent: tool({
    description: "Délègue une sous-tâche à un agent spécialisé (email, calendar, productivity, projects, research) et récupère sa synthèse.",
    schema: z.object({ agent: z.enum(["email", "calendar", "productivity", "projects", "research"]), task: z.string().min(3).max(2000) }),
    summarize: (i) => `Délégation à l'agent ${i.agent}`,
    async run(ctx, i) {
      const { runAgent } = await import("./agents");
      const r = await runAgent(ctx.db, ctx.userId, i.agent, i.task, { parentSources: ctx.sources, conversationId: ctx.conversationId ?? null });
      return { agent: i.agent, status: r.status, result: r.output, pendingActions: r.pending };
    },
  }),
  consulter_ecole: tool({
    description: "Consulte l'école (École Directe + saisies manuelles) : emploi du temps, devoirs à faire, évaluations prévues, notes récentes et moyennes.",
    schema: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    summarize: () => "Consultation de l'école",
    async run({ db, userId, sources }, i) {
      const s = await import("../school/school");
      const from = i.from ?? isoDate();
      const to = i.to ?? isoDate(new Date(Date.now() + 7 * 86400_000));
      const { timetableView } = await import("../school/timetable");
      // Emploi du temps à jour : modifications de la vie scolaire, jours fériés et vacances compris.
      const view = await timetableView(db, userId, new Date(`${from}T00:00:00`), new Date(`${to}T23:59:59`));
      const lessons = view.items;
      const homework = await s.listHomework(db, userId, { from, to });
      const grades = (await s.listGrades(db, userId)).slice(0, 15);
      sources.push({ type: "school", id: "school", title: "École", href: "/school" });
      return {
        lessons: lessons.map((l) => ({ subject: l.subject, start: l.startAt, end: l.endAt, room: l.room, teacher: l.teacher, cancelled: l.cancelled, change: l.change ? `${l.change.kind} — ${l.change.note}` : undefined })),
        closedDays: view.days.map((d) => ({ date: d.date, title: d.title })),
        homework: homework.map((h) => ({ subject: h.subject, dueDate: h.dueDate, isTest: h.isTest, done: h.done, title: h.title, details: untrusted("ecoledirecte", (h.contentHtml ?? "").replace(/<[^>]+>/g, " ").slice(0, 600)) })),
        recentGrades: grades.map((g) => ({ subject: g.subject, title: g.title, value: g.value, outOf: g.outOf, coef: g.coef, date: g.date })),
        averages: s.averages(grades),
      };
    },
  }),
} satisfies Record<ToolName, ToolImpl<z.ZodType>>;

/* ---------------------------------------------------------------- politique & exécution */

export async function toolPolicy(db: DB, userId: string) {
  const [p] = await db.select({ t: schema.userPreferences.toolPermissions }).from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId));
  const overrides = p?.t ?? {};
  return (name: ToolName): "allow" | "confirm" | "deny" => {
    if (ALWAYS_CONFIRM.includes(name)) return overrides[name] === "deny" ? "deny" : "confirm";
    return overrides[name] ?? defaultToolPolicy(name);
  };
}

/** Outils exposés au modèle : ceux autorisés (allow/confirm) et, pour un agent, limités à ses permissions. */
export async function availableTools(db: DB, userId: string, allowed?: string[]): Promise<ToolSpec[]> {
  const policy = await toolPolicy(db, userId);
  const { integrationsState } = await import("./context");
  const st = await integrationsState(db, userId);
  return (Object.keys(IMPLS) as ToolName[])
    .filter((n) => (!allowed || allowed.includes(n)) && policy(n) !== "deny")
    .filter((n) => {
      const svc = (TOOLS[n] as { service?: string }).service;
      return svc !== "gmail" || st.gmail; // sans Gmail connecté, les outils email ne sont pas proposés (le calendrier local fonctionne sans Google)
    })
    .map((n) => ({ name: n, description: IMPLS[n].description, schema: IMPLS[n].schema, jsonSchema: toolJsonSchema(IMPLS[n].schema) }));
}

export type Execution =
  | { kind: "result"; content: string; isError?: boolean }
  | { kind: "pending"; pendingId: string; summary: string };

/**
 * Exécute un appel d'outil demandé par le modèle :
 * 1. vérifie que l'outil existe et est autorisé pour cet utilisateur / agent ;
 * 2. valide strictement les paramètres ;
 * 3. si l'outil exige une confirmation, crée une action en attente au lieu d'agir ;
 * 4. sinon exécute (toujours scopé à userId) et journalise.
 */
export async function executeTool(ctx: ToolCtx, name: string, input: unknown, opts: { allowed?: string[] } = {}): Promise<Execution> {
  if (!(name in IMPLS)) return { kind: "result", content: JSON.stringify({ error: `Outil inconnu : ${name}` }), isError: true };
  const tool = name as ToolName;
  if (opts.allowed && !opts.allowed.includes(tool)) return { kind: "result", content: JSON.stringify({ error: `Permission refusée : l'agent n'a pas accès à ${tool}` }), isError: true };
  const policy = (await toolPolicy(ctx.db, ctx.userId))(tool);
  if (policy === "deny") return { kind: "result", content: JSON.stringify({ error: `Outil désactivé par l'utilisateur : ${tool}` }), isError: true };
  const impl = IMPLS[tool] as ToolImpl<z.ZodType>;
  const parsed = impl.schema.safeParse(input);
  if (!parsed.success) return { kind: "result", content: JSON.stringify({ error: "Paramètres invalides", issues: z.flattenError(parsed.error).fieldErrors }), isError: true };

  if (policy === "confirm") {
    const summary = impl.summarize(parsed.data);
    const [p] = await ctx.db
      .insert(schema.aiPendingActions)
      .values({ userId: ctx.userId, conversationId: ctx.conversationId ?? null, agentKey: ctx.agentKey ?? null, tool, args: parsed.data as Record<string, unknown>, summary })
      .returning();
    return { kind: "pending", pendingId: p.id, summary };
  }
  return runImpl(ctx, tool, parsed.data);
}

async function runImpl(ctx: ToolCtx, tool: ToolName, data: unknown): Promise<Execution> {
  const impl = IMPLS[tool] as ToolImpl<z.ZodType>;
  const started = Date.now();
  try {
    const result = await impl.run(ctx, data);
    log.info("ai.tool", { tool, userId: ctx.userId, agent: ctx.agentKey, ms: Date.now() - started, ok: true });
    if (TOOLS[tool].sensitivity !== "read") await logActivity(ctx.db, ctx.userId, { type: "ai.action", title: `IA : ${impl.summarize(data)}`, meta: { tool, agent: ctx.agentKey } });
    return { kind: "result", content: JSON.stringify(result) };
  } catch (e) {
    log.warn("ai.tool", { tool, userId: ctx.userId, ms: Date.now() - started, ok: false, error: (e as Error).message });
    return { kind: "result", content: JSON.stringify({ error: (e as Error).message }), isError: true };
  }
}

/** Décision explicite de l'utilisateur sur une action en attente. */
export async function decidePending(db: DB, userId: string, id: string, approve: boolean, edits?: Record<string, unknown>) {
  const [p] = await db.select().from(schema.aiPendingActions).where(and(eq(schema.aiPendingActions.id, id), eq(schema.aiPendingActions.userId, userId)));
  if (!p) throw new AppError("not_found", "Action introuvable");
  if (p.status !== "pending") throw new AppError("conflict", "Cette action a déjà été traitée.");
  if (!approve) {
    const [r] = await db.update(schema.aiPendingActions).set({ status: "rejected", decidedAt: new Date() }).where(eq(schema.aiPendingActions.id, id)).returning();
    return r;
  }
  const tool = p.tool as ToolName;
  if (!(tool in IMPLS)) throw new AppError("bad_request", "Outil inconnu");
  const args = edits ? { ...p.args, ...edits } : p.args;
  const parsed = (IMPLS[tool] as ToolImpl<z.ZodType>).schema.safeParse(args);
  if (!parsed.success) throw new AppError("bad_request", "Paramètres invalides après modification");
  // verrou optimiste : une seule exécution même en cas de double clic
  const [locked] = await db
    .update(schema.aiPendingActions)
    .set({ status: "approved", decidedAt: new Date(), args: parsed.data as Record<string, unknown> })
    .where(and(eq(schema.aiPendingActions.id, id), eq(schema.aiPendingActions.status, "pending")))
    .returning();
  if (!locked) throw new AppError("conflict", "Cette action a déjà été traitée.");
  const sources: Source[] = [];
  const r = await runImpl({ db, userId, conversationId: p.conversationId, agentKey: p.agentKey, sources }, tool, parsed.data);
  const ok = r.kind === "result" && !r.isError;
  const [done] = await db
    .update(schema.aiPendingActions)
    .set({ status: ok ? "executed" : "failed", result: r.kind === "result" ? (safeJson(r.content) as Record<string, unknown>) : null, error: ok ? null : r.kind === "result" ? r.content : null })
    .where(eq(schema.aiPendingActions.id, id))
    .returning();
  if (p.conversationId) {
    await db.insert(schema.aiMessages).values({
      userId,
      conversationId: p.conversationId,
      role: "assistant",
      content: ok ? `✓ Action effectuée après ta validation : ${p.summary}.` : `✗ L'action « ${p.summary} » a échoué : ${(safeJson(r.kind === "result" ? r.content : "{}") as { error?: string })?.error ?? "erreur"}`,
      sources,
    });
  }
  return done;
}

export async function pendingByIds(db: DB, userId: string, ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(schema.aiPendingActions).where(and(eq(schema.aiPendingActions.userId, userId), inArray(schema.aiPendingActions.id, ids)));
}

/* ---------------------------------------------------------------- utilitaires */

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

const SENSITIVE = /(mot de passe|password|\bmdp\b|iban|carte bancaire|\bcb\b|num[ée]ro de s[ée]cu|s[ée]curit[ée] sociale|passeport|code pin|\bpin\b|token|api[ _-]?key|diagnostic|maladie|traitement m[ée]dical)/i;
export const looksSensitive = (s: string) => SENSITIVE.test(s) || /\b\d{13,19}\b/.test(s.replace(/\s/g, ""));

export function textToHtml(t: string) {
  const esc = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}

/** Markdown simple → document TipTap (titres, listes, cases à cocher, paragraphes). */
export function markdownToDoc(md: string): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  const text = (t: string) => (t ? [{ type: "text", text: t }] : []);
  const lines = md.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = l.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      content.push({ type: "heading", attrs: { level: h[1].length }, content: text(h[2]) });
      continue;
    }
    if (/^\s*- \[[ xX]\]\s+/.test(l)) {
      const items: Record<string, unknown>[] = [];
      while (i < lines.length && /^\s*- \[[ xX]\]\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*- \[([ xX])\]\s+(.*)/)!;
        items.push({ type: "taskItem", attrs: { checked: m[1] !== " " }, content: [{ type: "paragraph", content: text(m[2]) }] });
        i++;
      }
      i--;
      content.push({ type: "taskList", content: items });
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items: Record<string, unknown>[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^\s*- \[/.test(lines[i])) {
        items.push({ type: "listItem", content: [{ type: "paragraph", content: text(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "").replace(/\*\*/g, "")) }] });
        i++;
      }
      i--;
      content.push({ type: ordered ? "orderedList" : "bulletList", content: items });
      continue;
    }
    if (l.trim()) content.push({ type: "paragraph", content: text(l.replace(/\*\*/g, "")) });
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
