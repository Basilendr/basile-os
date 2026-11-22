import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DB } from "@/lib/db";

process.env.DATA_DIR = "/tmp/claude-501/bos-test-data";

let db: DB;
let userId: string;

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
const SES = `Lien social : relation rattachant un individu à d'autres.
Protection : ressources mobilisables.
Reconnaissance : sentiment de compter pour autrui.
Capital social : ensemble des ressources accessibles grâce aux relations.
Solidarité organique : cohésion fondée sur la complémentarité et l'interdépendance.`;

/** Simule l'IA : extraction des définitions d'un cours, analyse des mots clés. */
function world(o: { fail?: boolean } = {}) {
  const calls = { extract: 0, keywords: 0 };
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    if (!String(input).includes("generativelanguage")) return json({});
    if (o.fail) return new Response("{}", { status: 400 });
    if (body.includes("mots importants : ceux")) {
      calls.keywords++;
      const items = [...body.matchAll(/(\d+)\. ([^:\\]+?) : /g)].map((m) => {
        const n = Number(m[1]);
        const kw: Record<string, string[]> = {
          "Lien social": ["relation", "individu", "inventé"],
          Protection: ["ressources mobilisables"],
          Reconnaissance: ["compter pour autrui"],
          "Capital social": ["ressources accessibles", "relations"],
          "Solidarité organique": ["complémentarité", "interdépendance"],
        };
        return { n, keywords: kw[m[2].trim()] ?? [] };
      });
      return json({ choices: [{ message: { content: JSON.stringify({ items }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
    }
    calls.extract++;
    const content = JSON.stringify({
      title: "Ch. 7 · Liens sociaux",
      subject: "SES",
      cards: [
        { term: "Nomenclature", definition: "Classement organisé en catégories.", keywords: ["classement", "catégories"] },
        { term: "Indépendant", definition: "Personne travaillant à son compte.", keywords: ["à son compte", "patron"] },
        { term: "Nomenclature", definition: "doublon", keywords: [] },
      ],
    });
    return json({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
  });
  return calls;
}

beforeAll(async () => {
  const { setup } = await import("./helpers");
  ({ db, userId } = await setup());
  const { schema } = await import("@/lib/db");
  const { setCachedSecret } = await import("@/lib/secrets");
  setCachedSecret("GEMINI_API_KEY", "AIza-test");
  const prefs = { aiProvider: "gemini", aiModel: "gemini-flash-latest" };
  await db.insert(schema.userPreferences).values({ userId, ...prefs }).onConflictDoUpdate({ target: schema.userPreferences.userId, set: prefs });
});
afterEach(() => vi.unstubAllGlobals());

describe("définitions : cœur", () => {
  it("lit une liste collée, même venue d'un encadré de cours", async () => {
    const { parseDefinitions } = await import("@/services/definitions/core");
    expect(parseDefinitions("Lien social : relation rattachant un individu à d'autres.\n- Lien fort = relation fréquente\n2) Lien faible → relation moins fréquente")).toEqual([
      { term: "Lien social", definition: "relation rattachant un individu à d'autres." },
      { term: "Lien fort", definition: "relation fréquente" },
      { term: "Lien faible", definition: "relation moins fréquente" },
    ]);
    // Encadré de Google Docs (sauts de ligne verticaux), deux-points dans la définition, ligne qui continue.
    const box = "♥ DÉFINITIONS\u000bPCS : Professions et Catégories Socioprofessionnelles : nomenclature de l'Insee.\u000bSalarié : personne travaillant pour un employeur\nen échange d'un salaire.";
    const r = parseDefinitions(box)!;
    expect(r.map((d) => d.term)).toEqual(["PCS", "Salarié"]);
    expect(r[0].definition).toBe("Professions et Catégories Socioprofessionnelles : nomenclature de l'Insee.");
    expect(r[1].definition).toBe("personne travaillant pour un employeur en échange d'un salaire.");
    expect(parseDefinitions("Émile Durkheim distingue deux formes de solidarité. Dans la solidarité mécanique, la cohésion repose sur la ressemblance.")).toBeNull();
  });

  it("mots importants : calcul local, validation, surlignage", async () => {
    const { autoKeywords, cleanKeywords, highlight } = await import("@/services/definitions/core");
    const kw = autoKeywords("Capital social", "Ensemble des ressources accessibles grâce aux relations.");
    expect(kw).toEqual(expect.arrayContaining(["ressources", "accessibles"]));
    expect(kw).not.toContain("des");
    expect(kw.some((k) => /social/i.test(k))).toBe(false);
    // Seuls les mots présents dans la définition sont gardés.
    expect(cleanKeywords(["relation", "inventé", "Individu", "de"], "relation rattachant un individu à d'autres.")).toEqual(["relation", "Individu"]);
    const segs = highlight("Cohésion fondée sur la complémentarité et l'interdépendance.", ["complementarite", "interdépendance"]);
    expect(segs.filter((s) => s.key).map((s) => s.text)).toEqual(["complémentarité", "interdépendance"]);
    expect(segs.map((s) => s.text).join("")).toBe("Cohésion fondée sur la complémentarité et l'interdépendance.");
    // Mot entier seulement : « lien » ne surligne pas « liens ».
    expect(highlight("Les liens et le lien.", ["lien"]).find((s) => s.key)?.text).toBe("lien");
  });

  it("corrige une définition écrite à partir des mots clés", async () => {
    const { checkDefinition } = await import("@/services/definitions/core");
    const kw = ["complémentarité", "interdépendance", "cohésion"];
    expect(checkDefinition("la cohesion repose sur la complementarite et l'interdependance des gens", kw)).toMatchObject({ grade: 3, missing: [] });
    const half = checkDefinition("c'est la cohésion par la complémentarité", kw);
    expect(half.grade).toBe(2);
    expect(half.missing).toEqual(["interdépendance"]);
    expect(checkDefinition("c'est quand tout le monde se ressemble", kw).grade).toBe(1);
    // Accords et pluriels acceptés, petites fautes aussi.
    expect(checkDefinition("des ressource mobilisable", ["ressources mobilisables"]).grade).toBe(3);
    expect(checkDefinition("interdépendence", ["interdépendance"]).grade).toBe(3);
    expect(checkDefinition("", kw).grade).toBe(1);
    expect(checkDefinition("une relation qui rattache un individu aux autres", ["relation", "rattachant"]).grade).toBe(3);
    expect(checkDefinition("la religion", ["relation"]).grade).toBe(1);
  });
});

describe("définitions : paquets", () => {
  it("liste collée : prête tout de suite, puis l'IA affine les mots clés", async () => {
    const calls = world();
    const f = await import("@/services/definitions/definitions");
    const r = await f.createDeck(db, userId, { source: "text", text: SES, title: "Ch. 7", subject: "SES" });
    expect(r).toMatchObject({ generating: false, analyze: true });
    let d = await f.getDeck(db, userId, r.id);
    expect(d.cards).toHaveLength(5);
    expect(d.keywordsStatus).toBe("generating");
    expect(d.cards.every((c) => c.keywordsBy === "auto" && c.keywords.length > 0)).toBe(true);

    await f.runKeywords(db, userId, r.id);
    d = await f.getDeck(db, userId, r.id);
    expect(calls.keywords).toBe(1);
    expect(d.keywordsStatus).toBe("ready");
    const lien = d.cards.find((c) => c.term === "Lien social")!;
    expect(lien).toMatchObject({ keywordsBy: "ai", keywords: ["relation", "individu"] });
    expect(d.cards.find((c) => c.term === "Solidarité organique")!.keywords).toEqual(["complémentarité", "interdépendance"]);
  });

  it("IA indisponible : les mots clés calculés sur place restent", async () => {
    world({ fail: true });
    const f = await import("@/services/definitions/definitions");
    const r = await f.createDeck(db, userId, { source: "manual", title: "Ch. 6", cards: [{ term: "Socialisation", definition: "Processus par lequel un individu apprend les normes et les valeurs de la société." }] });
    await f.runKeywords(db, userId, r.id);
    const d = await f.getDeck(db, userId, r.id);
    expect(d.keywordsStatus).toBe("error");
    expect(d.cards[0].keywords.length).toBeGreaterThan(0);
    expect(d.cards[0].keywordsBy).toBe("auto");
  });

  it("cours lu par l'IA : définitions et mots clés vérifiés", async () => {
    const calls = world();
    const f = await import("@/services/definitions/definitions");
    const r = await f.createDeck(db, userId, { source: "text", text: "Pour étudier la structure sociale, l'Insee rassemble les professions dans une nomenclature : un classement organisé en catégories. Un indépendant travaille à son compte." });
    expect(r.generating).toBe(true);
    await f.runExtraction(db, userId, r.id);
    const d = await f.getDeck(db, userId, r.id);
    expect(calls.extract).toBe(1);
    expect(d).toMatchObject({ status: "ready", title: "Ch. 7 · Liens sociaux", subject: "SES", keywordsStatus: "ready" });
    expect(d.cards.map((c) => c.term)).toEqual(["Nomenclature", "Indépendant"]);
    // « patron » n'est pas dans la définition : écarté.
    expect(d.cards[1].keywords).toEqual(["à son compte"]);
  });

  it("modification, séance, répétition espacée", async () => {
    world({ fail: true });
    const f = await import("@/services/definitions/definitions");
    const r = await f.createDeck(db, userId, { source: "manual", title: "PCS", cards: [{ term: "Salarié", definition: "Personne travaillant pour un employeur en échange d'un salaire." }] });
    await f.addCards(db, userId, r.id, { text: "Indépendant : personne travaillant à son compte.\nSalarié : doublon" });
    let d = await f.getDeck(db, userId, r.id);
    expect(d.cards.map((c) => c.term)).toEqual(["Salarié", "Indépendant"]);

    await f.updateCard(db, userId, d.cards[0].id, { keywords: ["employeur", "salaire", "absent"] });
    d = await f.getDeck(db, userId, r.id);
    expect(d.cards[0]).toMatchObject({ keywords: ["employeur", "salaire"], keywordsBy: "manual" });
    // Définition retouchée : les mots clés choisis à la main encore présents sont gardés.
    await f.updateCard(db, userId, d.cards[0].id, { definition: "Personne qui travaille pour un employeur contre un salaire." });
    d = await f.getDeck(db, userId, r.id);
    expect(d.cards[0].keywords).toEqual(["employeur", "salaire"]);

    const s1 = await f.studySet(db, userId, { deck: r.id });
    expect(s1.cards).toHaveLength(2);
    expect(s1.pool).toHaveLength(2);
    expect((await f.reviewCard(db, userId, s1.cards[0].id, { grade: 3 })).interval).toBe(1);
    expect((await f.reviewCard(db, userId, s1.cards[1].id, { grade: 1 })).interval).toBe(0);
    const o = await f.overview(db, userId);
    expect(o.decks.find((x) => x.id === r.id)).toMatchObject({ total: 2, fresh: 0, due: 1 });
    await f.resetDeck(db, userId, r.id);
    expect((await f.overview(db, userId)).decks.find((x) => x.id === r.id)).toMatchObject({ fresh: 2, due: 0 });
    await f.deleteDeck(db, userId, r.id);
    await expect(f.getDeck(db, userId, r.id)).rejects.toThrow();
  });
});
