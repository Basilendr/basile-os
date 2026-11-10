import { route } from "@/lib/api";
import { todayView } from "@/services/today";

/** Écran « Aujourd'hui ». */
export const GET = route({}, async ({ db, user }) => todayView(db, user.id));
