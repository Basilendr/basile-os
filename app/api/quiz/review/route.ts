import { route } from "@/lib/api";
import { createReview } from "@/services/quiz/quiz";

export const POST = route({}, async ({ db, user }) => createReview(db, user.id));
