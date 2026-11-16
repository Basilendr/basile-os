import { route } from "@/lib/api";
import { resetDeck } from "@/services/flashcards/flashcards";

export const POST = route({}, async ({ db, user, params }) => resetDeck(db, user.id, params.id));
