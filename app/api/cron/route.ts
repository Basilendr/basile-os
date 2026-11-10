import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runDueJobs } from "@/services/scheduler";

export const maxDuration = 300;

/** Tâches périodiques déclenchées de l'extérieur (Vercel Cron) — protégé par CRON_SECRET. */
export async function GET(req: Request) {
  if (!env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Non autorisé" } }, { status: 401 });
  }
  return NextResponse.json({ ran: await runDueJobs() });
}
