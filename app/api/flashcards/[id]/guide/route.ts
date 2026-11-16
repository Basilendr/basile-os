import { after } from "next/server";
import { route } from "@/lib/api";
import { prepareGuide, runGuide } from "@/services/flashcards/flashcards";

export const maxDuration = 300;

/** (Re)crée la fiche pour apprendre le cours. */
export const POST = route({ rate: [6, 60_000] }, async ({ db, user, params }) => {
  const r = await prepareGuide(db, user.id, params.id);
  after(() => runGuide(db, user.id, params.id));
  return r;
});
