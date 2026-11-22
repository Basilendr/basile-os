import { route } from "@/lib/api";
import { resetDeck } from "@/services/definitions/definitions";

export const POST = route({}, async ({ db, user, params }) => resetDeck(db, user.id, params.id));
