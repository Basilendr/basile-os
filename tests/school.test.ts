import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { setup } from "./helpers";
import { connect, answer, syncSchool, listLessons, listHomework, listGrades, averages, setHomeworkDone, addHomework, deleteManual, messageContent, getAccount } from "@/services/school/school";
import { decrypt } from "@/lib/crypto";
import { addDays, isoDate } from "@/lib/utils";

let db: DB;
let userId: string;
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const today = isoDate();

/** Faux serveur École Directe reproduisant le format documenté (code/token/data). */
function fakeEd(opts: { qcm?: boolean; expireOnce?: boolean } = {}) {
  let tokenN = 0;
  let expired = !opts.expireOnce;
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const ok = (data: unknown) => new Response(JSON.stringify({ code: 200, token: `tok${++tokenN}`, data }));
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const raw = typeof init?.body === "string" ? decodeURIComponent(init.body.replace(/^data=/, "")) : "{}";
    const body = JSON.parse(raw || "{}");
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.includes("gtk=1")) return new Response("", { headers: { "set-cookie": "GTK=gtkvalue; Path=/" } });
    if (url.includes("/v3/login.awp")) {
      if (body.motdepasse !== "bon-mdp") return new Response(JSON.stringify({ code: 505, token: "", message: "Mot de passe invalide !", data: { accounts: [] } }));
      if (opts.qcm && !body.fa?.length) return new Response(JSON.stringify({ code: 250, token: "tmp", data: {} }), { headers: { "2fa-token": "deux-fa", "set-cookie": "SESSION=abc; Path=/" } });
      return ok({ accounts: [{ id: 42, typeCompte: "E", prenom: "Basile", nom: "André", nomEtablissement: "Lycée Test", anneeScolaireCourante: "2026-2027", profile: { classe: { libelle: "Terminale 3" } } }] });
    }
    if (url.includes("doubleauth.awp") && url.includes("verbe=get")) return ok({ question: b64("Quelle est votre année de naissance ?"), propositions: [b64("2007"), b64("2008")] });
    if (url.includes("doubleauth.awp") && url.includes("verbe=post")) return body.choix === b64("2008") ? ok({ cn: "CN", cv: "CV" }) : new Response(JSON.stringify({ code: 520, data: {} }));
    if (!expired) {
      expired = true;
      return new Response(JSON.stringify({ code: 525, token: "", data: {} }));
    }
    if (url.includes("emploidutemps")) return ok([{ id: 1, text: "MATHS", matiere: "MATHEMATIQUES", codeMatiere: "MATHS", typeCours: "COURS", start_date: `${today} 08:00`, end_date: `${today} 09:00`, color: "#ff0000", prof: "M. Euler", salle: "B12", isAnnule: false }]);
    if (/cahierdetexte\/\d{4}-\d{2}-\d{2}/.test(url)) return ok({ date: today, matieres: [{ matiere: "FRANCAIS", codeMatiere: "FRANC", nomProf: "Mme Hugo", id: 7, interrogation: true, aFaire: { idDevoir: 7, contenu: b64("<p>Réviser le chapitre 3</p>"), donneLe: today, effectue: false } }] });
    if (url.includes("cahierdetexte.awp") && url.includes("verbe=put")) return ok({});
    if (url.includes("cahierdetexte.awp")) return ok({ [isoDate(addDays(new Date(), 2))]: [{ matiere: "FRANCAIS", codeMatiere: "FRANC", idDevoir: 7, donneLe: today, effectue: false, interrogation: true }] });
    if (url.includes("notes.awp")) return ok({ notes: [{ id: 9, devoir: "DS 1", codePeriode: "A001", libelleMatiere: "MATHEMATIQUES", typeDevoir: "CONTROLE", commentaire: "", coef: "2", noteSur: "20", valeur: "15,5", nonSignificatif: false, date: today, moyenneClasse: "12" }] });
    if (/messages\/\d+\.awp/.test(url)) return ok({ content: b64("<p>Réunion parents-profs jeudi</p>"), files: [] });
    if (url.includes("messages.awp")) return ok({ messages: { received: [{ id: 300, subject: "Réunion", date: `${today} 10:00:00`, read: false, from: { civilite: "M.", nom: "Proviseur" } }] } });
    return new Response(JSON.stringify({ code: 404, data: {} }));
  });
  return { fn, calls };
}

beforeAll(async () => {
  ({ db, userId } = await setup());
});
afterEach(() => vi.unstubAllGlobals());

describe("École Directe", () => {
  it("refuse de mauvais identifiants sans rien enregistrer", async () => {
    vi.stubGlobal("fetch", fakeEd().fn);
    await expect(connect(db, userId, "eleve", "faux")).rejects.toThrow(/incorrect/);
    expect(await getAccount(db, userId)).toBeNull();
  });

  it("gère la double authentification puis se connecte en chiffrant les identifiants", async () => {
    const ed = fakeEd({ qcm: true });
    vi.stubGlobal("fetch", ed.fn);
    const r = await connect(db, userId, "eleve", "bon-mdp");
    expect(r.status).toBe("qcm_required");
    expect(r.qcm?.question).toBe("Quelle est votre année de naissance ?");
    expect(r.qcm?.propositions.map((p) => p.label)).toEqual(["2007", "2008"]);
    const login = ed.calls.find((c) => c.url.includes("/v3/login.awp?v="));
    expect(login?.headers["x-gtk"]).toBe("gtkvalue");
    const done = await answer(db, userId, 1);
    expect(done).toMatchObject({ status: "connected", studentName: "Basile André", className: "Terminale 3" });
    const a = (await getAccount(db, userId))!;
    expect(a.passwordEnc).not.toContain("bon-mdp");
    expect(decrypt(a.passwordEnc)).toBe("bon-mdp");
    expect(JSON.parse(decrypt(a.faEnc!))).toEqual([{ cn: "CN", cv: "CV", uniq: false }]);
    // comme l'application web : 2FA-Token et cookies transmis, cn/cv en clair au login final, GTK neuf
    const getQ = ed.calls.find((c) => c.url.includes("doubleauth.awp") && c.url.includes("verbe=get"))!;
    expect(getQ.headers["2fa-token"]).toBe("deux-fa");
    expect(getQ.headers.cookie).toContain("SESSION=abc");
    const final = ed.calls.filter((c) => c.url.includes("/v3/login.awp?v=")).at(-1)!;
    expect(final.body).toMatchObject({ cn: "CN", cv: "CV", fa: [{ cn: "CN", cv: "CV" }] });
    expect(ed.calls.filter((c) => c.url.includes("gtk=1")).length).toBe(2);
  });

  it("synchronise emploi du temps, devoirs, évaluations, notes et messages, et se reconnecte si le jeton expire", async () => {
    const ed = fakeEd({ expireOnce: true });
    vi.stubGlobal("fetch", ed.fn);
    const r = await syncSchool(db, userId);
    expect(r).toMatchObject({ lessons: 1, homework: 1, grades: 1, messages: 1 });
    expect(ed.calls.filter((c) => c.url.includes("/v3/login.awp?v=")).length).toBe(1); // reconnexion automatique avec fa mémorisé
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const lessons = await listLessons(db, userId, start, addDays(start, 1));
    expect(lessons[0]).toMatchObject({ subject: "MATHEMATIQUES", teacher: "M. Euler", room: "B12", source: "ecoledirecte" });
    const tests = await listHomework(db, userId, { kind: "test" });
    expect(tests[0]).toMatchObject({ subject: "FRANCAIS", isTest: true, title: "Réviser le chapitre 3" });
    const grades = await listGrades(db, userId);
    expect(averages(grades).subjects[0]).toMatchObject({ subject: "MATHEMATIQUES", average: 15.5 });
    const [msg] = await db.select().from(schema.schoolMessages).where(eq(schema.schoolMessages.userId, userId));
    expect(msg).toMatchObject({ subject: "Réunion", fromName: "M. Proviseur", read: false });
    const full = await messageContent(db, userId, msg.id);
    expect(full.contentHtml).toContain("Réunion parents-profs");
    // idempotence : une seconde synchro ne duplique rien
    await syncSchool(db, userId);
    expect((await listHomework(db, userId, {})).length).toBe(1);
  });

  it("répercute « fait » sur École Directe et permet les ajouts manuels", async () => {
    const ed = fakeEd();
    vi.stubGlobal("fetch", ed.fn);
    const [h] = await listHomework(db, userId, { kind: "test" });
    const u = await setHomeworkDone(db, userId, h.id, true);
    expect(u).toMatchObject({ done: true, synced: true });
    const put = ed.calls.find((c) => c.url.includes("verbe=put"));
    expect(put?.body).toEqual({ idDevoirsEffectues: [7], idDevoirsNonEffectues: [] });
    const m = await addHomework(db, userId, { subject: "Histoire", title: "Exposé", dueDate: isoDate(addDays(new Date(), 3)), isTest: false });
    expect(m.source).toBe("manual");
    await expect(deleteManual(db, userId, "homework", h.id)).rejects.toThrow(/manuellement/);
    await deleteManual(db, userId, "homework", m.id);
  });

  it("calcule les moyennes pondérées en ignorant les notes non significatives et absences", () => {
    const r = averages([
      { subject: "A", value: "10", outOf: "20", coef: "1", nonSignificant: false },
      { subject: "A", value: "8", outOf: "10", coef: "2", nonSignificant: false },
      { subject: "A", value: "0", outOf: "20", coef: "1", nonSignificant: true },
      { subject: "A", value: "Abs", outOf: "20", coef: "1", nonSignificant: false },
    ]);
    expect(r.subjects[0].average).toBe(14);
  });
});

describe("Météo", () => {
  it("décrit les codes WMO", async () => {
    const { describeWeather } = await import("@/services/weather");
    expect(describeWeather(0).label).toBe("Ensoleillé");
    expect(describeWeather(63).icon).toBe("rain");
  });
});
