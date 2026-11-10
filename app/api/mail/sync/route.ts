import { route } from "@/lib/api";
import { syncMail } from "@/services/mail/mail";

export const POST = route({ rate: [10, 60_000] }, async ({ db, user }) => syncMail(db, user.id));
