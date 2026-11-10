import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createSession, currentUser, logSecurityEvent } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { handleCallback, handleLoginCallback } from "@/services/google/oauth";
import { syncCalendar } from "@/services/google/calendar";
import { syncGmail } from "@/services/google/gmail";
import { log } from "@/lib/log";
import type { DB } from "@/lib/db";

function initialSync(db: DB, userId: string, connected: string[]) {
  if (connected.includes("calendar")) syncCalendar(db, userId).catch((e) => log.warn("calendar.initial_sync_failed", { error: String(e) }));
  if (connected.includes("gmail")) syncGmail(db, userId).catch((e) => log.warn("gmail.initial_sync_failed", { error: String(e) }));
}

/** Retour OAuth Google : connexion d'un service (session existante) ou « Connexion avec Google ». */
export async function GET(req: NextRequest) {
  const db = await getDb();
  const sp = req.nextUrl.searchParams;
  const params = { code: sp.get("code"), state: sp.get("state"), error: sp.get("error") };
  const [st] = params.state ? await db.select({ purpose: schema.oauthStates.purpose }).from(schema.oauthStates).where(eq(schema.oauthStates.state, params.state)) : [];
  if (st?.purpose === "login") {
    try {
      const r = await handleLoginCallback(db, params);
      await createSession(r.userId);
      await logSecurityEvent(r.userId, r.created ? "account.created.google" : "login.google", { email: r.email, services: r.connected });
      initialSync(db, r.userId, r.connected);
      return NextResponse.redirect(`${env.APP_URL}${r.returnTo}`);
    } catch (e) {
      log.warn("oauth.login_failed", { error: (e as Error).message });
      return NextResponse.redirect(`${env.APP_URL}/login?error=${encodeURIComponent((e as Error).message)}`);
    }
  }
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${env.APP_URL}/login`);
  try {
    const r = await handleCallback(db, user.id, params);
    await logSecurityEvent(user.id, "oauth.google.connected", { services: r.connected, email: r.email });
    initialSync(db, user.id, r.connected);
    return NextResponse.redirect(`${env.APP_URL}${r.returnTo}?connected=${r.connected.join(",")}`);
  } catch (e) {
    log.warn("oauth.callback_failed", { error: (e as Error).message });
    return NextResponse.redirect(`${env.APP_URL}/integrations?error=${encodeURIComponent((e as Error).message)}`);
  }
}
