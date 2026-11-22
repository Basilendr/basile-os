import { route } from "@/lib/api";
import { ReviewInput, reviewCard } from "@/services/definitions/definitions";

/** Note une définition révisée et renvoie sa prochaine date. */
export const POST = route({ body: ReviewInput, rate: [300, 60_000] }, async ({ db, user, params, body }) => reviewCard(db, user.id, params.cardId, body));
