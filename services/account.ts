import "server-only";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { AGENTS, DEFAULT_WIDGETS, WIDGETS, WIDGET_SLOTS, type AgentKey } from "@/lib/catalog";
import { AppError } from "@/lib/errors";

export async function hasAnyUser(db: DB) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  return (r?.n ?? 0) > 0;
}

/** Création du compte propriétaire (premier lancement uniquement). */
export async function createOwner(db: DB, input: { email: string; password: string; displayName: string; timezone?: string }) {
  if (await hasAnyUser(db)) throw new AppError("forbidden", "Un compte existe déjà sur cette instance.");
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(schema.users).values({ email: input.email.toLowerCase(), passwordHash }).returning();
    await tx.insert(schema.profiles).values({
      userId: user.id,
      displayName: input.displayName,
      timezone: input.timezone ?? "Europe/Paris",
    });
    await tx.insert(schema.userPreferences).values({ userId: user.id });
    await seedDefaults(tx as unknown as DB, user.id);
    return user;
  });
}

/** Création du compte propriétaire via « Connexion avec Google » (premier lancement uniquement). */
export async function createOwnerFromGoogle(db: DB, input: { email: string; sub: string; name: string; picture: string | null }) {
  if (await hasAnyUser(db)) throw new AppError("forbidden", "Un compte existe déjà sur cette instance.");
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(schema.users).values({ email: input.email, passwordHash: "!", googleSub: input.sub }).returning();
    await tx.insert(schema.profiles).values({ userId: user.id, displayName: input.name, avatarUrl: input.picture });
    await tx.insert(schema.userPreferences).values({ userId: user.id });
    await seedDefaults(tx as unknown as DB, user.id);
    return user;
  });
}

/** Configuration initiale (widgets, agents) — aucune donnée personnelle fictive. */
export async function seedDefaults(db: DB, userId: string) {
  await db
    .insert(schema.dashboardWidgets)
    .values(
      DEFAULT_WIDGETS.map((k, i) => ({
        userId,
        widgetKey: k,
        position: i,
        size: WIDGETS[k].defaultSize,
        visible: i < WIDGET_SLOTS,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(schema.agents)
    .values(
      (Object.keys(AGENTS) as AgentKey[]).map((key) => ({
        userId,
        key,
        enabled: true,
        permissions: [...AGENTS[key].defaultPermissions],
      })),
    )
    .onConflictDoNothing();
}

export async function getProfile(db: DB, userId: string) {
  const [row] = await db
    .select({ profile: schema.profiles, prefs: schema.userPreferences, email: schema.users.email })
    .from(schema.users)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .innerJoin(schema.userPreferences, eq(schema.userPreferences.userId, schema.users.id))
    .where(eq(schema.users.id, userId));
  if (!row) throw new AppError("not_found", "Profil introuvable");
  return row;
}
