import "server-only";
import { desc, eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";

export type ActivityInput = {
  type: string;
  title: string;
  entityType?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
};

export async function logActivity(db: DB, userId: string, a: ActivityInput) {
  await db.insert(schema.activityLogs).values({ userId, ...a, meta: a.meta ?? {} });
}

export async function recentActivity(db: DB, userId: string, limit = 30) {
  return db
    .select()
    .from(schema.activityLogs)
    .where(eq(schema.activityLogs.userId, userId))
    .orderBy(desc(schema.activityLogs.createdAt))
    .limit(limit);
}
