import { beforeAll, describe, expect, it, vi, afterEach } from "vitest";
import type { DB } from "@/lib/db";

process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.DATA_DIR = "/tmp/claude-501/bos-test-data";

let db: DB;
let userId: string;

beforeAll(async () => {
  const { setup } = await import("./helpers");
  ({ db, userId } = await setup());
});
afterEach(() => vi.unstubAllGlobals());

describe("chiffrement des jetons", () => {
  it("AES-256-GCM aller-retour et détection de falsification", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const c = encrypt("ya29.secret-token");
    expect(c).not.toContain("secret");
    expect(decrypt(c)).toBe("ya29.secret-token");
    const parts = c.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});

describe("OAuth Google", () => {
  it("génère une URL PKCE avec state et refuse un state inconnu", async () => {
    const { buildAuthUrl, handleCallback } = await import("@/services/google/oauth");
    const url = new URL(await buildAuthUrl(db, userId, ["gmail"]));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("gmail.modify");
    expect(url.searchParams.get("access_type")).toBe("offline");
    await expect(handleCallback(db, userId, { code: "x", state: "inconnu" })).rejects.toThrow(/invalide/);
  });

  it("ne marque un service connecté qu'après un échange de code réussi, et renouvelle le jeton expiré", async () => {
    const { buildAuthUrl, handleCallback, getAccessToken } = await import("@/services/google/oauth");
    const { schema } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const state = new URL(await buildAuthUrl(db, userId, ["gmail", "calendar"])).searchParams.get("state")!;
    // Google refuse le code : aucune intégration connectée
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));
    await expect(handleCallback(db, userId, { code: "bad", state })).rejects.toThrow(/Google OAuth/);
    expect((await db.select().from(schema.integrations).where(eq(schema.integrations.userId, userId))).filter((i) => i.status === "connected")).toHaveLength(0);

    const state2 = new URL(await buildAuthUrl(db, userId, ["gmail", "calendar"])).searchParams.get("state")!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) =>
        String(u).includes("userinfo")
          ? new Response(JSON.stringify({ email: "basileandre1002@gmail.com" }))
          : new Response(JSON.stringify({ access_token: "at1", refresh_token: "rt1", expires_in: 1, scope: "openid email https://www.googleapis.com/auth/gmail.modify" })),
      ),
    );
    const r = await handleCallback(db, userId, { code: "ok", state: state2 });
    expect(r.connected).toEqual(["gmail"]); // calendrier non accordé → pas connecté
    const ints = await db.select().from(schema.integrations).where(eq(schema.integrations.userId, userId));
    expect(ints.find((i) => i.service === "gmail")?.status).toBe("connected");
    expect(ints.find((i) => i.service === "calendar")?.status).toBe("error");
    const [tok] = await db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.userId, userId));
    expect(tok.accessTokenEnc).not.toContain("at1");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "at2", expires_in: 3600, scope: "openid email" }))));
    expect(await getAccessToken(db, userId)).toBe("at2"); // jeton expiré → renouvelé
  });

  it("le client Google réessaie sur 429 puis réussit", async () => {
    const { gfetch } = await import("@/services/google/client");
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (++n < 2 ? new Response("{}", { status: 429, headers: { "retry-after": "0" } }) : new Response(JSON.stringify({ ok: true })))),
    );
    expect(await gfetch(db, userId, "https://gmail.googleapis.com/gmail/v1/users/me/profile")).toEqual({ ok: true });
    expect(n).toBe(2);
  });
});

describe("Gmail", () => {
  it("construit un message MIME sans injection d'en-têtes", async () => {
    const { buildMime, parseAddress } = await import("@/services/google/gmail");
    const raw = Buffer.from(buildMime({ to: ["a@b.test"], subject: "Salut\r\nBcc: pirate@evil.test", html: "<p>é</p>", text: "é" }), "base64url").toString();
    expect(raw).not.toMatch(/\r\nBcc: pirate/);
    expect(raw).toContain("Subject: Salut Bcc: pirate@evil.test");
    const raw2 = Buffer.from(buildMime({ to: ["a@b.test"], subject: "Réunion", html: "", text: "" }), "base64url").toString();
    expect(raw2).toContain("Subject: =?UTF-8?B?");
    expect(parseAddress('"Jean Dupont" <Jean@Ex.com>')).toEqual({ name: "Jean Dupont", email: "jean@ex.com" });
  });

  it("refuse les actions Gmail quand le service n'est pas connecté", async () => {
    const { schema } = await import("@/lib/db");
    const { createOwner } = await import("@/services/account");
    void schema;
    void createOwner;
    const { listMessages } = await import("@/services/google/gmail");
    const [other] = await db.insert((await import("@/lib/db")).schema.users).values({ email: "g2@b.test", passwordHash: "x" }).returning();
    await expect(listMessages(db, other.id, { folder: "inbox" })).rejects.toThrow(/Gmail n'est pas connecté/);
  });
});

describe("Google Calendar", () => {
  it("convertit un événement Google (journée entière et horaire)", async () => {
    const { toLocal } = await import("@/services/google/calendar");
    const a = toLocal({ id: "1", summary: "Congés", start: { date: "2026-11-10" }, end: { date: "2026-11-11" } });
    expect(a.allDay).toBe(true);
    const b = toLocal({ id: "2", summary: "RDV", start: { dateTime: "2026-11-10T10:00:00+01:00", timeZone: "Europe/Paris" }, end: { dateTime: "2026-11-10T11:00:00+01:00" }, colorId: "11", attendees: [{ email: "x@y.test", responseStatus: "accepted" }] });
    expect(b.startAt.toISOString()).toBe("2026-11-10T09:00:00.000Z");
    expect(b.color).toBe("#d50000");
    expect(b.attendees).toEqual([{ email: "x@y.test", name: undefined, status: "accepted" }]);
  });
});
