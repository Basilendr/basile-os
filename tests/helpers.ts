import { createEmbeddedDb, type DB } from "@/lib/db";
import { createOwner } from "@/services/account";

/** Base PostgreSQL en mémoire avec migrations réelles + un compte propriétaire. */
export async function setup(): Promise<{ db: DB; userId: string }> {
  const db = await createEmbeddedDb();
  const user = await createOwner(db, { email: "test@basile-os.test", password: "correct-horse-battery", displayName: "Test" });
  return { db, userId: user.id };
}
