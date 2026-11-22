import { after } from "next/server";
import { route } from "@/lib/api";
import { retryDeck, runExtraction } from "@/services/definitions/definitions";

export const maxDuration = 300;

export const POST = route({ rate: [6, 60_000] }, async ({ db, user, params }) => {
  const r = await retryDeck(db, user.id, params.id);
  after(() => runExtraction(db, user.id, params.id));
  return r;
});
