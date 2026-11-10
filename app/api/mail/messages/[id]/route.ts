import { route, zId } from "@/lib/api";
import { readMail } from "@/services/mail/mail";

export const GET = route({ rate: [60, 60_000] }, async ({ db, user, params }) => readMail(db, user.id, zId.parse(params.id)));
