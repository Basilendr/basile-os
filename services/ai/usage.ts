import "server-only";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import type { Usage } from "./provider";

export async function recordUsage(db: DB, userId: string, u: Usage, feature: string) {
  await db.insert(schema.aiUsage).values({ userId, provider: u.provider, model: u.model, feature, inputTokens: u.inputTokens, outputTokens: u.outputTokens });
}
