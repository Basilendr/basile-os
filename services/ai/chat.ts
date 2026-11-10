import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { aiSettings, systemPrompt, type PageContext } from "./context";
import { runLoop, type ChatTurn } from "./provider";
import { availableTools, executeTool, pendingByIds, type Source } from "./tools";
import { recordUsage } from "./usage";

export type StreamEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; delta: string }
  | { type: "step"; id: string; tool: string; status: "running" | "done" | "error" | "awaiting_approval"; summary: string }
  | { type: "pending"; action: { id: string; tool: string; summary: string; args: Record<string, unknown>; status: string } }
  | { type: "sources"; items: Source[] }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string; code?: string };

const STEP_LABELS: Record<string, string> = {
  rechercher_emails: "Recherche dans Gmail",
  lire_email: "Lecture d'un email",
  resumer_email: "Lecture du fil",
  rechercher_calendrier: "Consultation du calendrier",
  trouver_creneaux: "Recherche de créneaux libres",
  rechercher_taches: "Analyse des tâches",
  rechercher_projets: "Analyse des projets",
  rechercher_notes: "Recherche dans les notes",
  rechercher_fichiers: "Recherche de documents",
  resumer_document: "Lecture d'un document",
  recherche_semantique: "Recherche sémantique",
  generer_briefing_quotidien: "Collecte des données du jour",
  consulter_memoire: "Consultation de la mémoire",
  deleguer_agent: "Délégation à un agent",
};

/** Tour de conversation diffusé en flux NDJSON : texte progressif, étapes, actions à valider, sources. */
export function streamTurn(db: DB, userId: string, input: { conversationId?: string | null; kind: "assistant" | "command"; message: string; page?: PageContext }, signal?: AbortSignal) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {}
      };
      try {
        const settings = await aiSettings(db, userId);
        if (!settings.configured) throw new AppError("not_configured", "Assistant IA non configuré : ajoute une clé (Anthropic, OpenAI ou Gemini gratuite) dans Paramètres → Configuration.");
        let convId = input.conversationId ?? null;
        if (convId) {
          const [c] = await db.select().from(schema.aiConversations).where(and(eq(schema.aiConversations.id, convId), eq(schema.aiConversations.userId, userId)));
          if (!c) throw new AppError("not_found", "Conversation introuvable");
        } else {
          const [c] = await db.insert(schema.aiConversations).values({ userId, kind: input.kind, title: input.message.slice(0, 70) }).returning();
          convId = c.id;
        }
        send({ type: "conversation", id: convId });
        const prior = await db.select().from(schema.aiMessages).where(eq(schema.aiMessages.conversationId, convId)).orderBy(asc(schema.aiMessages.createdAt));
        await db.insert(schema.aiMessages).values({ userId, conversationId: convId, role: "user", content: input.message, context: (input.page ?? {}) as Record<string, unknown> });

        const history: ChatTurn[] = mergeTurns([...prior.slice(-30).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })), { role: "user", content: input.message }]);
        const tools = await availableTools(db, userId);
        const system = await systemPrompt(db, userId, { mode: input.kind, page: input.page });
        const sources: Source[] = [];
        const steps: { tool: string; status: string; summary: string }[] = [];
        const pendingIds: string[] = [];
        let stepN = 0;

        const r = await runLoop({
          provider: settings.provider,
          model: settings.model,
          system,
          history,
          tools,
          signal,
          effort: input.kind === "command" ? "high" : "medium",
          onText: (d) => send({ type: "text", delta: d }),
          execute: async (call) => {
            const id = `s${++stepN}`;
            const label = STEP_LABELS[call.name] ?? call.name;
            send({ type: "step", id, tool: call.name, status: "running", summary: label });
            const res = await executeTool({ db, userId, conversationId: convId, sources }, call.name, call.input);
            if (res.kind === "pending") {
              pendingIds.push(res.pendingId);
              steps.push({ tool: call.name, status: "awaiting_approval", summary: res.summary });
              send({ type: "step", id, tool: call.name, status: "awaiting_approval", summary: res.summary });
              const [p] = await pendingByIds(db, userId, [res.pendingId]);
              send({ type: "pending", action: { id: p.id, tool: p.tool, summary: p.summary, args: p.args, status: p.status } });
              return { content: JSON.stringify({ status: "en attente de confirmation explicite de l'utilisateur — ne pas considérer comme effectué", pendingActionId: res.pendingId }) };
            }
            steps.push({ tool: call.name, status: res.isError ? "error" : "done", summary: label });
            send({ type: "step", id, tool: call.name, status: res.isError ? "error" : "done", summary: label });
            return { content: res.content, isError: res.isError };
          },
        });
        await recordUsage(db, userId, r.usage, input.kind);
        const uniq = dedupe(sources);
        if (uniq.length) send({ type: "sources", items: uniq });
        const [msg] = await db
          .insert(schema.aiMessages)
          .values({ userId, conversationId: convId, role: "assistant", content: r.text, steps, sources: uniq, context: { pending: pendingIds } })
          .returning();
        await db.update(schema.aiConversations).set({ updatedAt: new Date() }).where(eq(schema.aiConversations.id, convId));
        send({ type: "done", messageId: msg.id });
      } catch (e) {
        log.warn("ai.turn_failed", { error: (e as Error).message });
        send({ type: "error", message: (e as Error).message, code: e instanceof AppError ? e.code : "internal" });
      } finally {
        controller.close();
      }
    },
  });
}

/** Le fil envoyé au modèle doit alterner user/assistant et commencer par user. */
function mergeTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    if (!t.content.trim()) continue;
    if (out.length && out[out.length - 1].role === t.role) out[out.length - 1] = { role: t.role, content: `${out[out.length - 1].content}\n\n${t.content}` };
    else out.push({ ...t });
  }
  while (out[0]?.role === "assistant") out.shift();
  return out;
}

function dedupe(s: Source[]) {
  const seen = new Set<string>();
  return s.filter((x) => (seen.has(`${x.type}:${x.id}`) ? false : (seen.add(`${x.type}:${x.id}`), true))).slice(0, 30);
}
