import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { AGENTS, type AgentKey } from "@/lib/catalog";
import { AppError } from "@/lib/errors";
import { notify } from "../notifications";
import { aiSettings, systemPrompt } from "./context";
import { runLoop } from "./provider";
import { availableTools, executeTool, type Source } from "./tools";
import { recordUsage } from "./usage";

const MISSIONS: Record<AgentKey, string> = {
  personal:
    "Tu es l'Agent Personnel : tu coordonnes les agents spécialisés via l'outil deleguer_agent (calendar, email, research, productivity, projects), puis tu assembles un briefing unique, sourcé et actionnable.",
  email:
    "Tu es l'Agent Email : analyse les emails, identifie les messages importants et ceux sans réponse, résume les conversations, extrais échéances et actions, propose des réponses sous forme de brouillons. Tu n'envoies JAMAIS d'email sans validation.",
  calendar: "Tu es l'Agent Calendrier : analyse le planning, détecte les conflits, trouve des disponibilités réelles, prépare les rendez-vous et propose des améliorations d'organisation.",
  productivity: "Tu es l'Agent Productivité : organise les tâches, identifie les priorités, repère les retards et reports répétés, propose un plan quotidien réaliste et décompose les objectifs.",
  projects: "Tu es l'Agent Projets : surveille l'avancement, identifie blocages et retards, propose les prochaines actions et génère des résumés d'avancement.",
  research: "Tu es l'Agent Recherche : recherche dans les notes, documents et emails, relie les informations entre elles et produis des synthèses en citant systématiquement les sources utilisées. La recherche Internet n'est pas disponible.",
};

export async function agentConfig(db: DB, userId: string, key: AgentKey) {
  const [a] = await db.select().from(schema.agents).where(and(eq(schema.agents.userId, userId), eq(schema.agents.key, key)));
  if (!a) throw new AppError("not_found", "Agent introuvable");
  return a;
}

/**
 * Exécution d'un agent : outils limités à ses permissions, historique enregistré,
 * actions sensibles laissées en attente de validation.
 */
export async function runAgent(db: DB, userId: string, key: AgentKey, input: string, opts: { parentSources?: Source[]; conversationId?: string | null; depth?: number } = {}) {
  const cfg = await agentConfig(db, userId, key);
  if (!cfg.enabled) throw new AppError("forbidden", `${AGENTS[key].name} est désactivé.`);
  const settings = await aiSettings(db, userId);
  const allowed = key === "personal" && (opts.depth ?? 0) > 0 ? cfg.permissions.filter((p) => p !== "deleguer_agent") : cfg.permissions;
  const tools = await availableTools(db, userId, allowed);
  const [run] = await db.insert(schema.agentRuns).values({ userId, agentKey: key, input }).returning();
  const steps: { tool: string; status: string; summary: string }[] = [];
  const sources: Source[] = opts.parentSources ?? [];
  const pending: { id: string; summary: string }[] = [];
  try {
    const system = await systemPrompt(db, userId, { mode: "agent", agentInstructions: `${MISSIONS[key]}${cfg.instructions ? `\nConsignes de l'utilisateur pour cet agent : ${cfg.instructions}` : ""}` });
    const r = await runLoop({
      provider: settings.provider,
      model: settings.model,
      system,
      history: [{ role: "user", content: input }],
      tools,
      effort: "medium",
      maxIterations: 8,
      execute: async (call) => {
        const res = await executeTool({ db, userId, conversationId: opts.conversationId ?? null, agentKey: key, sources }, call.name, call.input, { allowed });
        if (res.kind === "pending") {
          pending.push({ id: res.pendingId, summary: res.summary });
          steps.push({ tool: call.name, status: "awaiting_approval", summary: res.summary });
          return { content: JSON.stringify({ status: "en attente de confirmation de l'utilisateur", pendingActionId: res.pendingId }) };
        }
        steps.push({ tool: call.name, status: res.isError ? "error" : "done", summary: call.name });
        return { content: res.content, isError: res.isError };
      },
    });
    await recordUsage(db, userId, r.usage, `agent:${key}`);
    await db.update(schema.agentRuns).set({ status: "success", output: r.text, steps, finishedAt: new Date() }).where(eq(schema.agentRuns.id, run.id));
    if (pending.length) await notify(db, userId, { type: "agent", title: `${AGENTS[key].name} : ${pending.length} action${pending.length > 1 ? "s" : ""} à valider`, href: "/command", dedupeKey: `agent-pending:${run.id}` });
    return { runId: run.id, status: "success" as const, output: r.text, steps, pending, sources };
  } catch (e) {
    await db.update(schema.agentRuns).set({ status: "failed", error: (e as Error).message, steps, finishedAt: new Date() }).where(eq(schema.agentRuns.id, run.id));
    throw e;
  }
}

export async function listAgents(db: DB, userId: string) {
  const rows = await db.select().from(schema.agents).where(eq(schema.agents.userId, userId));
  const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.userId, userId)).orderBy(desc(schema.agentRuns.startedAt)).limit(200);
  return rows.map((a) => {
    const mine = runs.filter((r) => r.agentKey === a.key);
    return { ...a, ...AGENTS[a.key as AgentKey], lastRun: mine[0] ?? null, runCount: mine.length, history: mine.slice(0, 20) };
  });
}
