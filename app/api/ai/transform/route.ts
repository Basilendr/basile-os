import { route } from "@/lib/api";
import { TransformZ, transform } from "@/services/ai/transform";

export const POST = route({ body: TransformZ.passthrough(), rate: [30, 60_000] }, async ({ db, user, body }) => transform(db, user.id, body));
