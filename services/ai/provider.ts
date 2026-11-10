import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { secret } from "@/lib/secrets";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";

/**
 * Couche fournisseur IA indépendante : le reste de l'application ne connaît que
 * `runLoop` / `complete` / `completeJson`. Anthropic (par défaut) et OpenAI sont pris en charge.
 * Les clés restent côté serveur.
 */

export type ProviderName = "anthropic" | "openai" | "gemini" | "groq" | "mistral";
type Compat = Exclude<ProviderName, "anthropic">;
export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ToolSpec = { name: string; description: string; schema: z.ZodType; jsonSchema: Record<string, unknown> };
export type ToolCall = { id: string; name: string; input: unknown };
export type ToolOutcome = { content: string; isError?: boolean };
export type Usage = { inputTokens: number; outputTokens: number; model: string; provider: ProviderName };

export const DEFAULT_MODELS: Record<ProviderName, string> = { anthropic: "claude-opus-5-5", openai: "gpt-5", gemini: "gemini-flash-latest", groq: "llama-3.3-70b-versatile", mistral: "mistral-medium-latest" };
export const MODEL_CHOICES: Record<ProviderName, string[]> = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
  openai: ["gpt-5", "gpt-5-mini"],
  gemini: ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest"],
  groq: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"],
  mistral: ["mistral-medium-latest", "mistral-small-latest", "mistral-large-latest"],
};
export const PROVIDER_LABELS: Record<ProviderName, string> = { anthropic: "Claude (Anthropic)", openai: "ChatGPT (OpenAI)", gemini: "Google Gemini", groq: "Groq", mistral: "Mistral" };

/** Clé et point d'accès compatible « Chat Completions » de chaque fournisseur hors Anthropic. */
const COMPAT: Record<Compat, { key: () => string | undefined; url: string; label: string }> = {
  openai: { key: () => secret("OPENAI_API_KEY"), url: "https://api.openai.com/v1/chat/completions", label: "OpenAI" },
  gemini: { key: () => secret("GEMINI_API_KEY"), url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", label: "Gemini" },
  groq: { key: () => secret("GROQ_API_KEY"), url: "https://api.groq.com/openai/v1/chat/completions", label: "Groq" },
  mistral: { key: () => secret("MISTRAL_API_KEY"), url: "https://api.mistral.ai/v1/chat/completions", label: "Mistral" },
};

export function providerConfigured(p: ProviderName) {
  return p === "anthropic" ? Boolean(secret("ANTHROPIC_API_KEY")) : Boolean(COMPAT[p]?.key());
}

/* ---------------------------------------------------------------- choix automatique de l'IA selon la fonction */

export type AiTask = "assistant" | "writing" | "quiz" | "document";

/**
 * Pour chaque fonction, l'ordre des IA essayées : la première configurée répond ; si elle est saturée,
 * à court de quota ou trop lente, la suivante prend le relais automatiquement.
 */
export const TASK_ROUTES: Record<AiTask, { label: string; description: string; chain: ProviderName[] }> = {
  assistant: { label: "Assistant et agents", description: "Discussion, recherche dans tes données, actions (tâches, agenda, mails).", chain: ["anthropic", "openai", "gemini", "groq", "mistral"] },
  writing: { label: "Textes courts", description: "Briefing du matin, résumés, reformulations, tri, planification : Groq, le plus rapide, passe en premier.", chain: ["anthropic", "openai", "groq", "gemini", "mistral"] },
  quiz: { label: "Quiz de révision", description: "Quiz tirés de tes cours (longs documents) : Gemini lit beaucoup de texte d'un coup.", chain: ["anthropic", "openai", "gemini", "mistral", "groq"] },
  document: { label: "Lecture de PDF et de photos", description: "Emplois du temps reçus, cours scannés ou photographiés : seuls Gemini et Mistral lisent les PDF.", chain: ["anthropic", "openai", "gemini", "mistral"] },
};

/** IA qui répondront, dans l'ordre, pour une fonction (le modèle choisi dans les réglages sert pour son fournisseur). */
export function routeFor(task: AiTask, preferred?: { provider: ProviderName; model: string }) {
  return TASK_ROUTES[task].chain.filter(providerConfigured).map((provider) => ({ provider, model: preferred?.provider === provider ? preferred.model : DEFAULT_MODELS[provider] }));
}

export const anyProviderConfigured = () => (Object.keys(DEFAULT_MODELS) as ProviderName[]).some(providerConfigured);

/** Erreur qui justifie de passer à l'IA suivante : quota, surcharge, lenteur, réponse inexploitable. */
function shouldFallback(e: unknown) {
  if (e instanceof AppError) return e.code === "rate_limited" || e.code === "integration_error" || e.code === "not_configured";
  return e instanceof SyntaxError || e instanceof z.ZodError || (e instanceof Error && /fetch failed|ECONNRESET|ETIMEDOUT/i.test(e.message));
}

async function routed<T>(task: AiTask, preferred: { provider: ProviderName; model: string }, run: (p: { provider: ProviderName; model: string }) => Promise<T>, canRetry: () => boolean = () => true): Promise<T> {
  const chain = routeFor(task, preferred);
  if (!chain.length) requireProvider(preferred.provider);
  let last: unknown;
  for (const [i, p] of chain.entries()) {
    try {
      return await run(p);
    } catch (e) {
      last = e;
      if (i === chain.length - 1 || !shouldFallback(e) || !canRetry()) throw e;
      log.warn("ai.route_fallback", { task, from: p.provider, to: chain[i + 1].provider, error: String(e).slice(0, 200) });
    }
  }
  throw last;
}

function requireProvider(p: ProviderName) {
  if (!providerConfigured(p)) {
    throw new AppError(
      "not_configured",
      `Fournisseur IA « ${p === "anthropic" ? "Anthropic" : COMPAT[p].label} » non configuré : ajoute sa clé dans Paramètres → Configuration.`,
    );
  }
}

let anthropicClient: { key: string; client: Anthropic } | null = null;
/** Client recréé si la clé change (saisie depuis l'interface). */
const anthropic = () => {
  const key = secret("ANTHROPIC_API_KEY")!;
  if (anthropicClient?.key !== key) anthropicClient = { key, client: new Anthropic({ apiKey: key, maxRetries: 2 }) };
  return anthropicClient.client;
};

/** Modèles qui acceptent le repli serveur `fallbacks: "default"` en cas de refus. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

function toAnthropicTool(t: ToolSpec): Anthropic.Beta.BetaTool {
  return { name: t.name, description: t.description, input_schema: t.jsonSchema as Anthropic.Beta.BetaTool.InputSchema, eager_input_streaming: true };
}

export type LoopOptions = {
  provider: ProviderName;
  model: string;
  system: string;
  history: ChatTurn[];
  tools: ToolSpec[];
  execute: (call: ToolCall) => Promise<ToolOutcome>;
  onText?: (delta: string) => void;
  maxIterations?: number;
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
  task?: AiTask;
};

/**
 * Boucle agentique manuelle : l'appelant contrôle chaque exécution d'outil
 * (permissions, confirmations, journalisation). Retourne le texte final et l'usage cumulé.
 */
export async function runLoop(o: LoopOptions): Promise<{ text: string; usage: Usage; stopReason: string }> {
  // Une IA qui a déjà commencé à répondre (texte affiché ou outil lancé) n'est pas remplacée en cours de route.
  let started = false;
  const watched: LoopOptions = {
    ...o,
    onText: (d) => {
      started = true;
      o.onText?.(d);
    },
    execute: (c) => {
      started = true;
      return o.execute(c);
    },
  };
  return routed(o.task ?? "assistant", o, (p) => (p.provider === "anthropic" ? anthropicLoop({ ...watched, ...p }) : openaiLoop({ ...watched, ...p }, p.provider)), () => !started && !o.signal?.aborted);
}

async function anthropicLoop(o: LoopOptions) {
  const messages: Anthropic.Beta.BetaMessageParam[] = o.history.map((h) => ({ role: h.role, content: h.content }));
  const tools = o.tools.map(toAnthropicTool);
  const usage: Usage = { inputTokens: 0, outputTokens: 0, model: o.model, provider: "anthropic" };
  let finalText = "";
  let jsonRetries = 0;
  for (let i = 0; i < (o.maxIterations ?? 10); i++) {
    const stream = anthropic().beta.messages.stream(
      {
        model: o.model,
        max_tokens: 32000,
        system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
        messages,
        ...(tools.length ? { tools } : {}),
        output_config: { effort: o.effort ?? "medium" },
        ...(FALLBACK_MODELS.has(o.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal: o.signal },
    );
    stream.on("text", (d) => {
      finalText += d;
      o.onText?.(d);
    });
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw mapError(err);
      log.warn("ai.tool_input_unparseable", { attempt: jsonRetries });
      continue;
    }
    usage.inputTokens += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    usage.outputTokens += msg.usage.output_tokens;
    if (msg.stop_reason === "refusal") return { text: finalText || "Je ne peux pas traiter cette demande.", usage, stopReason: "refusal" };
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!calls.length || msg.stop_reason === "end_turn") return { text: finalText, usage, stopReason: msg.stop_reason ?? "end_turn" };
    if (msg.stop_reason === "max_tokens") throw new AppError("integration_error", "Réponse IA tronquée (limite de jetons).");
    messages.push({ role: "assistant", content: msg.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const c of calls) {
      const out = await o.execute({ id: c.id, name: c.name, input: c.input });
      results.push({ type: "tool_result", tool_use_id: c.id, content: out.content, is_error: out.isError });
    }
    messages.push({ role: "user", content: results });
    if (finalText && !finalText.endsWith("\n")) {
      finalText += "\n\n";
      o.onText?.("\n\n");
    }
  }
  return { text: finalText || "Limite d'étapes atteinte.", usage, stopReason: "max_iterations" };
}

function mapError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new AppError("not_configured", "Clé API Anthropic invalide.");
  if (err instanceof Anthropic.RateLimitError) return new AppError("rate_limited", "Limite du fournisseur IA atteinte, réessaie dans un instant.");
  if (err instanceof Anthropic.APIError) return new AppError("integration_error", `Fournisseur IA (${err.status}) : ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}

/* ---------------------------------------------------------------- OpenAI (Chat Completions) */

type OAIMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string };

async function openaiChat(body: Record<string, unknown>, signal?: AbortSignal, provider: Compat = "openai", timeoutMs = 90_000): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    return await compatCall(body, signal, provider, timeoutMs);
  } catch (e) {
    // Gemini gratuit : modèle saturé (503), sans réponse (504) ou quota du modèle atteint (429) → repli sur Flash-Lite, plus disponible.
    const fallback = "gemini-flash-lite-latest";
    if (provider === "gemini" && body.model !== fallback && e instanceof AppError && (e.details as { status?: number } | undefined)?.status && [429, 503, 504].includes((e.details as { status: number }).status)) {
      log.warn("ai.gemini_fallback", { from: String(body.model) });
      return compatCall({ ...body, model: fallback }, signal, provider, timeoutMs);
    }
    throw e;
  }
}

async function compatCall(body: Record<string, unknown>, signal: AbortSignal | undefined, provider: Compat, timeoutMs = 90_000) {
  const c = COMPAT[provider];
  // Sans signal de l'appelant (tâches de fond), une requête restée sans réponse est abandonnée (90 s par défaut).
  if (!c.key()) throw new AppError("not_configured", `${c.label} n'est pas configuré.`);
  const res = await fetch(c.url, {
    method: "POST",
    headers: { authorization: `Bearer ${c.key()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  }).catch((e) => {
    if (!signal && (e as Error)?.name === "TimeoutError") throw new AppError("integration_error", `${c.label} met trop de temps à répondre : réessaie dans un instant.`, { status: 504 });
    throw e;
  });
  const raw = await res.json().catch(() => null);
  const d = Array.isArray(raw) ? raw[0] : raw; // Gemini peut renvoyer l'erreur dans un tableau
  if (!res.ok)
    throw new AppError(
      res.status === 429 ? "rate_limited" : "integration_error",
      res.status === 429 && provider !== "openai" ? `Quota gratuit ${c.label} atteint pour le moment : réessaie dans une minute (ou demain si le quota du jour est épuisé).` : res.status === 401 ? `Clé ${c.label} refusée : vérifie-la dans les réglages.` : res.status === 503 ? `${c.label} est surchargé pour le moment : réessaie dans un instant.` : `${c.label} (${res.status}) : ${d?.error?.message ?? "erreur"}`,
      { status: res.status },
    );
  return d;
}

async function openaiLoop(o: LoopOptions, provider: Compat) {
  const messages: OAIMessage[] = [{ role: "system", content: o.system }, ...o.history.map((h) => ({ role: h.role, content: h.content }))];
  const tools = o.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.jsonSchema } }));
  const usage: Usage = { inputTokens: 0, outputTokens: 0, model: o.model, provider };
  for (let i = 0; i < (o.maxIterations ?? 10); i++) {
    const d = await openaiChat({ model: o.model, messages, ...(tools.length ? { tools } : {}) }, o.signal, provider);
    usage.inputTokens += d.usage?.prompt_tokens ?? 0;
    usage.outputTokens += d.usage?.completion_tokens ?? 0;
    const m = d.choices[0].message as OAIMessage;
    if (!m.tool_calls?.length) {
      const text = m.content ?? "";
      o.onText?.(text); // réponse non progressive avec ce fournisseur
      return { text, usage, stopReason: "end_turn" };
    }
    messages.push(m);
    for (const c of m.tool_calls) {
      let input: unknown = {};
      try {
        input = JSON.parse(c.function.arguments);
      } catch {
        messages.push({ role: "tool", tool_call_id: c.id, content: "Arguments JSON invalides" });
        continue;
      }
      const out = await o.execute({ id: c.id, name: c.function.name, input });
      messages.push({ role: "tool", tool_call_id: c.id, content: out.isError ? `ERREUR : ${out.content}` : out.content });
    }
  }
  return { text: "Limite d'étapes atteinte.", usage, stopReason: "max_iterations" };
}

/* ---------------------------------------------------------------- appels simples */

/** Réponse texte unique (résumé, reformulation…). */
export async function complete(o: { provider: ProviderName; model: string; system: string; prompt: string; effort?: "low" | "medium" | "high"; task?: AiTask }): Promise<{ text: string; usage: Usage }> {
  const r = await runLoop({ ...o, task: o.task ?? "writing", history: [{ role: "user", content: o.prompt }], tools: [], execute: async () => ({ content: "" }), maxIterations: 1 });
  return { text: r.text.trim(), usage: r.usage };
}

/** Sortie structurée validée par Zod (outputs structurés côté Anthropic, JSON mode côté OpenAI). */
export async function completeJson<T extends z.ZodType>(o: { provider: ProviderName; model: string; system: string; prompt: string; schema: T; effort?: "low" | "medium" | "high"; timeoutMs?: number; task?: AiTask }): Promise<{ data: z.infer<T>; usage: Usage }> {
  return routed(o.task ?? "writing", o, (p) => completeJsonWith({ ...o, ...p }));
}

async function completeJsonWith<T extends z.ZodType>(o: { provider: ProviderName; model: string; system: string; prompt: string; schema: T; effort?: "low" | "medium" | "high"; timeoutMs?: number }): Promise<{ data: z.infer<T>; usage: Usage }> {
  requireProvider(o.provider);
  const jsonSchema = strictJsonSchema(o.schema);
  if (o.provider === "anthropic") {
    try {
      const stream = anthropic().beta.messages.stream({
        model: o.model,
        max_tokens: 16000,
        system: o.system,
        messages: [{ role: "user", content: o.prompt }],
        output_config: { effort: o.effort ?? "low", format: { type: "json_schema", schema: jsonSchema } },
        ...(FALLBACK_MODELS.has(o.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw new AppError("integration_error", "Le modèle a refusé cette demande.");
      const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return {
        data: o.schema.parse(JSON.parse(text)),
        usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, model: o.model, provider: "anthropic" },
      };
    } catch (e) {
      throw e instanceof AppError ? e : e instanceof SyntaxError || e instanceof z.ZodError ? new AppError("integration_error", "Réponse IA mal formée.") : mapError(e);
    }
  }
  const gemini = o.provider === "gemini";
  // Seul OpenAI applique un schéma strict ; les autres reçoivent le schéma dans la consigne et répondent en JSON.
  const loose = o.provider !== "openai";
  const body = {
    model: o.model,
    messages: [
      { role: "system", content: loose ? `${o.system}\n\nRéponds uniquement avec un objet JSON conforme à ce schéma : ${JSON.stringify(jsonSchema)}` : o.system },
      { role: "user", content: o.prompt },
    ],
    response_format: loose ? { type: "json_object" } : { type: "json_schema", json_schema: { name: "result", schema: jsonSchema, strict: true } },
  };
  const provider = o.provider as Compat;
  // Gemini : l'effort de réflexion borne le temps de réponse ; un modèle qui refuse ce réglage (400) est rappelé sans.
  const d = gemini
    ? await openaiChat({ ...body, reasoning_effort: o.effort ?? "low" }, undefined, provider, o.timeoutMs).catch((e) => {
        if (e instanceof AppError && (e.details as { status?: number } | undefined)?.status === 400) return openaiChat(body, undefined, provider, o.timeoutMs);
        throw e;
      })
    : await openaiChat(body, undefined, provider, o.timeoutMs);
  try {
    const text = String(d.choices[0].message.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "");
    return { data: o.schema.parse(JSON.parse(text)), usage: { inputTokens: d.usage?.prompt_tokens ?? 0, outputTokens: d.usage?.completion_tokens ?? 0, model: o.model, provider: o.provider } };
  } catch {
    throw new AppError("integration_error", "Réponse IA mal formée.");
  }
}

/** JSON Schema strict : objets fermés et toutes les propriétés requises (nullables si optionnelles). */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const s = z.toJSONSchema(schema, { target: "draft-7", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete s.$schema;
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (o.type === "object" && o.properties) {
      o.additionalProperties = false;
      o.required = Object.keys(o.properties as object);
    }
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(s);
  return s;
}

/** JSON Schema d'entrée d'outil (non strict, validé ensuite par Zod). */
export function toolJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const s = z.toJSONSchema(schema, { target: "draft-7", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/* ---------------------------------------------------------------- lecture de documents (vision) */

/** Lit une image ou un PDF (photo de cours manuscrit, document scanné) et répond en texte. */
type DocInput = { provider: ProviderName; model: string; system: string; prompt: string; data: Buffer; mimeType: string; json?: boolean; timeoutMs?: number; lowThinking?: boolean };
export async function readDocument(o: DocInput): Promise<{ text: string; usage: Usage }> {
  return routed("document", o, async (p) => {
    const r = await readDocumentWith({ ...o, ...p });
    if (!r.text) throw new AppError("integration_error", "Réponse vide.");
    return r;
  });
}

async function readDocumentWith(o: DocInput): Promise<{ text: string; usage: Usage }> {
  requireProvider(o.provider);
  const b64 = o.data.toString("base64");
  const pdf = o.mimeType === "application/pdf";
  if (o.provider === "anthropic") {
    try {
      const file = pdf
        ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: b64 } }
        : { type: "image" as const, source: { type: "base64" as const, media_type: o.mimeType as "image/jpeg", data: b64 } };
      const msg = await anthropic().messages.create({ model: o.model, max_tokens: 16000, system: o.system, messages: [{ role: "user", content: [file, { type: "text", text: o.prompt }] }] });
      return { text: msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim(), usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, model: o.model, provider: "anthropic" } };
    } catch (e) {
      throw mapError(e);
    }
  }
  if (o.provider === "openai") {
    const part = pdf ? { type: "file", file: { filename: "document.pdf", file_data: `data:application/pdf;base64,${b64}` } } : { type: "image_url", image_url: { url: `data:${o.mimeType};base64,${b64}` } };
    const d = await openaiChat({ model: o.model, messages: [{ role: "system", content: o.system }, { role: "user", content: [part, { type: "text", text: o.prompt }] }] }, undefined, "openai");
    return { text: String(d.choices[0].message.content ?? "").trim(), usage: { inputTokens: d.usage?.prompt_tokens ?? 0, outputTokens: d.usage?.completion_tokens ?? 0, model: o.model, provider: "openai" } };
  }
  if (o.provider === "mistral") {
    const part = pdf ? { type: "document_url", document_url: `data:application/pdf;base64,${b64}` } : { type: "image_url", image_url: `data:${o.mimeType};base64,${b64}` };
    const d = await openaiChat({ model: o.model, messages: [{ role: "system", content: o.system }, { role: "user", content: [part, { type: "text", text: o.prompt }] }], ...(o.json ? { response_format: { type: "json_object" } } : {}) }, undefined, "mistral", o.timeoutMs ?? 120_000);
    return { text: String(d.choices[0].message.content ?? "").trim(), usage: { inputTokens: d.usage?.prompt_tokens ?? 0, outputTokens: d.usage?.completion_tokens ?? 0, model: o.model, provider: "mistral" } };
  }
  if (o.provider === "groq") throw new AppError("integration_error", "Groq ne lit pas les documents.");
  // Gemini : API native, seule à accepter les PDF et les photos (HEIC compris) en pièce jointe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (model: string, thinking = !!o.lowThinking): Promise<{ d: any; model: string }> => {
    const generationConfig = { ...(o.json ? { responseMimeType: "application/json" } : {}), ...(thinking ? { thinkingConfig: { thinkingBudget: 512 } } : {}) };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": secret("GEMINI_API_KEY")!, "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: o.system }] }, contents: [{ role: "user", parts: [{ inlineData: { mimeType: o.mimeType, data: b64 } }, { text: o.prompt }] }], ...(Object.keys(generationConfig).length ? { generationConfig } : {}) }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 120_000),
    }).catch((e) => {
      if ((e as Error)?.name === "TimeoutError") throw new AppError("integration_error", "Gemini met trop de temps à répondre : réessaie dans un instant.", { status: 504 });
      throw e;
    });
    const raw = await res.json().catch(() => null);
    const d = Array.isArray(raw) ? raw[0] : raw;
    // Modèle qui n'accepte pas le réglage de réflexion : on réessaie sans.
    if (res.status === 400 && thinking) return call(model, false);
    if (!res.ok)
      throw new AppError(
        res.status === 429 ? "rate_limited" : "integration_error",
        res.status === 429 ? "Quota gratuit Gemini atteint pour le moment : réessaie dans une minute (ou demain si le quota du jour est épuisé)." : res.status === 503 ? "Gemini est surchargé pour le moment : réessaie dans un instant." : `Gemini (${res.status}) : ${d?.error?.message ?? "erreur"}`,
        { status: res.status },
      );
    return { d, model };
  };
  const fallback = "gemini-flash-lite-latest";
  const { d, model } = await call(o.model).catch((e) => {
    if (o.model !== fallback && e instanceof AppError && [429, 503, 504].includes((e.details as { status?: number } | undefined)?.status ?? 0)) return call(fallback);
    throw e;
  });
  const text = ((d?.candidates?.[0]?.content?.parts ?? []) as { text?: string }[]).map((p) => p.text ?? "").join("").trim();
  return { text, usage: { inputTokens: d?.usageMetadata?.promptTokenCount ?? 0, outputTokens: d?.usageMetadata?.candidatesTokenCount ?? 0, model, provider: "gemini" } };
}
