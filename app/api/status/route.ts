import { eq } from "drizzle-orm";
import { after } from "next/server";
import { serverless } from "@/lib/env";
import { runDueJobs } from "@/services/scheduler";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { googleConfigured } from "@/lib/env";
import { providerConfigured } from "@/services/ai/provider";
import { unreadCount } from "@/services/notifications";

/** État réel des services : rien n'est déclaré connecté sans autorisation effective. */
export const GET = route({}, async ({ db, user }) => {
  // Sans processus permanent, l'interface ouverte fait avancer rappels et synchronisations.
  if (serverless) after(() => runDueJobs(db).catch(() => null));
  const [prefs] = await db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, user.id));
  const ints = await db.select().from(schema.integrations).where(eq(schema.integrations.userId, user.id));
  const byService = Object.fromEntries(ints.map((i) => [i.service, { status: i.status, lastSyncAt: i.lastSyncAt, lastError: i.lastError, accountEmail: i.accountEmail }]));
  const provider = prefs?.aiProvider ?? "anthropic";
  const aiConfigured = providerConfigured(provider === "openai" || provider === "gemini" ? provider : "anthropic");
  return {
    ai: { configured: aiConfigured, provider, model: prefs?.aiModel },
    google: {
      configured: googleConfigured(),
      services: {
        gmail: byService.gmail ?? { status: "disconnected" },
        calendar: byService.calendar ?? { status: "disconnected" },
        drive: byService.drive ?? { status: "disconnected" },
        contacts: byService.contacts ?? { status: "disconnected" },
      },
    },
    unreadNotifications: await unreadCount(db, user.id),
  };
});
