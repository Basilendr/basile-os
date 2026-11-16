import { after } from "next/server";
import { route } from "@/lib/api";
import { quizFromDeck } from "@/services/flashcards/flashcards";
import { runGeneration } from "@/services/quiz/quiz";

export const maxDuration = 300;

/** Quiz complet sur le cours du paquet (compréhension, grammaire, traduction). */
export const POST = route({ rate: [6, 60_000] }, async ({ db, user, params }) => {
  const r = await quizFromDeck(db, user.id, params.id);
  after(() => runGeneration(db, user.id, r.id));
  return r;
});
