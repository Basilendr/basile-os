import { after } from "next/server";
import { route } from "@/lib/api";
import { checkUser, finishPending } from "@/services/quiz/schedule";

/** « Préparer mon quiz maintenant » : repère les cours tout de suite, rédige les questions en arrière-plan. */
export const POST = route({ rate: [6, 60_000] }, async ({ db, user }) => {
  const r = await checkUser(db, user.id, { force: true, defer: true });
  if (r.pending.length) after(() => finishPending(db, user.id, r.pending));
  return { pending: r.pending.length };
});
