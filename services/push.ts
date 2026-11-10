import "server-only";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { schema, type DB } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Notifications push sur le téléphone (iPhone : seulement depuis l'app installée sur l'écran d'accueil).
 * Les clés VAPID sont créées automatiquement au premier usage et gardées chiffrées en base.
 */

type Keys = { publicKey: string; privateKey: string };
const g = globalThis as unknown as { __basileVapid?: Keys };
const NAME = "VAPID_KEYS";

export async function vapidKeys(db: DB): Promise<Keys> {
  if (g.__basileVapid) return g.__basileVapid;
  const [row] = await db.select().from(schema.instanceSecrets).where(eq(schema.instanceSecrets.name, NAME));
  if (row) return (g.__basileVapid = JSON.parse(decrypt(row.valueEnc)) as Keys);
  const keys = webpush.generateVAPIDKeys();
  await db.insert(schema.instanceSecrets).values({ name: NAME, valueEnc: encrypt(JSON.stringify(keys)) }).onConflictDoNothing();
  // Une autre instance a pu créer les clés en même temps : on relit celles qui sont en base.
  const [saved] = await db.select().from(schema.instanceSecrets).where(eq(schema.instanceSecrets.name, NAME));
  return (g.__basileVapid = JSON.parse(decrypt(saved.valueEnc)) as Keys);
}

export type PushMessage = { title: string; body?: string; href?: string; tag?: string };

/** Envoie à tous les appareils abonnés de l'utilisateur ; supprime les abonnements expirés. */
export async function sendPush(db: DB, userId: string, msg: PushMessage) {
  const subs = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
  if (!subs.length) return 0;
  const keys = await vapidKeys(db);
  const subject = env.APP_URL?.startsWith("https://") ? env.APP_URL : "mailto:notifications@basile-os.invalid";
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: msg.title, body: msg.body ?? "", href: msg.href ?? "/", tag: msg.tag }), {
          vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 6 * 3600,
          urgency: "high",
        });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id));
        else log.warn("push.failed", { status, error: String(e).slice(0, 200) });
      }
    }),
  );
  return sent;
}
