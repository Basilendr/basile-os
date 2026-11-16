import { route } from "@/lib/api";
import { ReviewInput, reviewCard } from "@/services/flashcards/flashcards";

/** Note une carte révisée et renvoie sa prochaine date. */
export const POST = route({ body: ReviewInput, rate: [300, 60_000] }, async ({ db, user, params, body }) => reviewCard(db, user.id, params.cardId, body));
