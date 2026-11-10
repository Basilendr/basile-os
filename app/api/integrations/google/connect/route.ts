import { z } from "zod";
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { buildAuthUrl } from "@/services/google/oauth";

const Q = z.object({ services: z.string().default("gmail,calendar"), returnTo: z.string().startsWith("/").max(200).optional() });

/** Démarre le flux OAuth (redirection vers l'écran de consentement Google). */
export const GET = route({ query: Q }, async ({ db, user, query }) => {
  const services = z.array(z.enum(["gmail", "calendar", "drive", "contacts"])).min(1).parse(query.services.split(","));
  const url = await buildAuthUrl(db, user.id, services, query.returnTo);
  return NextResponse.redirect(url);
});
