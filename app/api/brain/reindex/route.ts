import { route } from "@/lib/api";
import { reindexAll } from "@/services/ai/embeddings";

export const POST = route({ rate: [3, 60_000] }, async ({ db, user }) => reindexAll(db, user.id));
