import { route } from "@/lib/api";
import { StudyQuery, studySet } from "@/services/flashcards/flashcards";

/** Cartes de la séance : à revoir aujourd'hui puis nouvelles (ou tout le paquet avec all=1). */
export const GET = route({ query: StudyQuery }, async ({ db, user, query }) => studySet(db, user.id, query));
