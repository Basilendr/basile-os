import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { sendPush, vapidKeys } from "@/services/push";

const p = schema.pushSubscriptions;

/** Clé publique pour s'abonner et nombre d'appareils déjà abonnés. */
export const GET = route({}, async ({ db, user }) => {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(p).where(eq(p.userId, user.id));
  return { publicKey: (await vapidKeys(db)).publicKey, devices: n };
});

const Sub = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
  device: z.string().max(120).optional(),
});

/** Abonne cet appareil (et envoie une notification d'essai si demandé). */
export const POST = route({ body: Sub }, async ({ db, user, body }) => {
  await db
    .insert(p)
    .values({ userId: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, device: body.device })
    .onConflictDoUpdate({ target: p.endpoint, set: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth, device: body.device } });
  const sent = await sendPush(db, user.id, { title: "Notifications activées", body: "Tu recevras ici tes quiz du soir et le rappel des devoirs du lendemain.", href: "/today" });
  return { ok: true, sent };
});

const Del = z.object({ endpoint: z.url().max(1000) });

export const DELETE = route({ query: Del }, async ({ db, user, query }) => {
  await db.delete(p).where(and(eq(p.userId, user.id), eq(p.endpoint, query.endpoint)));
  return { ok: true };
});
