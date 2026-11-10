import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { setCachedSecret } from "@/lib/secrets";
import { completeJson, providerConfigured, runLoop } from "@/services/ai/provider";

afterEach(() => vi.unstubAllGlobals());

describe("fournisseur Gemini (point d'accès compatible)", () => {
  it("n'est actif qu'avec une clé, appelle Google avec la clé en en-tête et exécute les outils", async () => {
    setCachedSecret("GEMINI_API_KEY", null);
    expect(providerConfigured("gemini")).toBe(false);
    setCachedSecret("GEMINI_API_KEY", "AIza-test");
    expect(providerConfigured("gemini")).toBe(true);

    const calls: { url: string; auth: string | null; body: { messages: { role: string }[] } }[] = [];
    const replies = [
      { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "lire", arguments: "{\"x\":1}" } }] } }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
      { choices: [{ message: { role: "assistant", content: "Terminé." } }], usage: { prompt_tokens: 12, completion_tokens: 3 } },
    ];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(replies[calls.length - 1]), { status: 200 });
    });
    const executed: unknown[] = [];
    const r = await runLoop({
      provider: "gemini",
      model: "gemini-flash-latest",
      system: "sys",
      history: [{ role: "user", content: "bonjour" }],
      tools: [{ name: "lire", description: "test", schema: z.object({ x: z.number() }), jsonSchema: { type: "object", properties: { x: { type: "number" } } } }],
      execute: async (c) => (executed.push(c.input), { content: "ok" }),
    });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(calls[0].auth).toBe("Bearer AIza-test");
    expect(executed).toEqual([{ x: 1 }]);
    expect(calls[1].body.messages.at(-1)?.role).toBe("tool");
    expect(r.text).toBe("Terminé.");
    expect(r.usage).toMatchObject({ inputTokens: 22, outputTokens: 5, provider: "gemini" });
  });

  it("traduit le quota gratuit épuisé en message clair et valide le JSON", async () => {
    setCachedSecret("GEMINI_API_KEY", "AIza-test");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify([{ error: { message: "quota" } }]), { status: 429 }));
    await expect(runLoop({ provider: "gemini", model: "gemini-flash-latest", system: "s", history: [{ role: "user", content: "x" }], tools: [], execute: async () => ({ content: "" }) })).rejects.toThrow(/Quota gratuit Gemini/);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: "```json\n{\"ok\":true}\n```" } }] }), { status: 200 }));
    const j = await completeJson({ provider: "gemini", model: "gemini-flash-latest", system: "s", prompt: "p", schema: z.object({ ok: z.boolean() }) });
    expect(j.data).toEqual({ ok: true });
  });
});

describe("Gemini saturé", () => {
  it("bascule sur Flash-Lite quand Flash répond 503", async () => {
    setCachedSecret("GEMINI_API_KEY", "AIza-test");
    const models: string[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      models.push(model);
      return model === "gemini-flash-latest"
        ? new Response(JSON.stringify([{ error: { message: "high demand" } }]), { status: 503 })
        : new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
    });
    const r = await runLoop({ provider: "gemini", model: "gemini-flash-latest", system: "s", history: [{ role: "user", content: "x" }], tools: [], execute: async () => ({ content: "" }) });
    expect(r.text).toBe("OK");
    expect(models).toEqual(["gemini-flash-latest", "gemini-flash-lite-latest"]);
  });
});
