import { z } from "zod";
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { LOGIN_SERVICES, buildAuthUrl } from "@/services/google/oauth";

/** « Se connecter avec Google » : redirige vers l'écran de consentement (documents, emails, agenda). */
export const GET = route({ auth: false, query: z.object({ next: z.string().startsWith("/").max(200).optional() }), rate: [20, 60_000] }, async ({ db, query }) => {
  const url = await buildAuthUrl(db, null, LOGIN_SERVICES, query.next && !query.next.startsWith("//") ? query.next : "/", "login");
  return NextResponse.redirect(url);
});
