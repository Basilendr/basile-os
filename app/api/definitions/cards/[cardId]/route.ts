import { after } from "next/server";
import { route } from "@/lib/api";
import { CardPatch, deleteCard, runKeywords, updateCard } from "@/services/definitions/definitions";

export const maxDuration = 300;

export const PATCH = route({ body: CardPatch }, async ({ db, user, params, body }) => {
  const r = await updateCard(db, user.id, params.cardId, body);
  if (r.analyze) after(() => runKeywords(db, user.id, r.deckId));
  return { ok: true };
});
export const DELETE = route({}, async ({ db, user, params }) => deleteCard(db, user.id, params.cardId));
