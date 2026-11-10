import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { setCachedSecret } from "@/lib/secrets";
import { completeJson, readDocument, routeFor } from "@/services/ai/provider";

afterEach(() => {
  vi.unstubAllGlobals();
  setCachedSecret("GROQ_API_KEY", null);
  setCachedSecret("MISTRAL_API_KEY", null);
});

describe("choix automatique de l'IA selon la fonction", () => {
  it("ordonne les IA configurées selon la fonction", () => {
    setCachedSecret("GEMINI_API_KEY", "AIza-test");
    setCachedSecret("GROQ_API_KEY", "gsk-test");
    setCachedSecret("MISTRAL_API_KEY", "mis-test");
    expect(routeFor("writing").map((r) => r.provider)).toEqual(["groq", "gemini", "mistral"]);
    expect(routeFor("assistant").map((r) => r.provider)).toEqual(["gemini", "groq", "mistral"]);
    expect(routeFor("quiz").map((r) => r.provider)).toEqual(["gemini", "mistral", "groq"]);
    expect(routeFor("document").map((r) => r.provider)).toEqual(["gemini", "mistral"]);
    expect(routeFor("writing", { provider: "groq", model: "openai/gpt-oss-120b" })[0]).toEqual({ provider: "groq", model: "openai/gpt-oss-120b" });
  });

  it("passe à l'IA suivante quand la première est saturée, et Mistral lit les PDF", async () => {
    setCachedSecret("GEMINI_API_KEY", "AIza-test");
    setCachedSecret("GROQ_API_KEY", "gsk-test");
    setCachedSecret("MISTRAL_API_KEY", "mis-test");
    const hosts: string[] = [];
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const host = new URL(url).host;
      hosts.push(host);
      if (host.includes("googleapis")) return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
      const body = JSON.parse(String(init.body));
      if (host.includes("mistral")) bodies.push(JSON.stringify(body.messages));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify({ ok: true }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
    const r = await completeJson({ provider: "gemini", model: "gemini-flash-latest", system: "s", prompt: "p", schema: z.object({ ok: z.boolean() }), task: "quiz" });
    expect(r.data.ok).toBe(true);
    expect(r.usage.provider).toBe("mistral");
    hosts.length = 0;
    const d = await readDocument({ provider: "gemini", model: "gemini-flash-latest", system: "s", prompt: "p", data: Buffer.from("%PDF"), mimeType: "application/pdf", json: true });
    expect(d.usage.provider).toBe("mistral");
    expect(hosts.some((h) => h.includes("groq"))).toBe(false);
    expect(bodies.at(-1)).toContain("document_url");
  });
});
