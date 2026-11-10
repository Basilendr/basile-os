import { route } from "@/lib/api";
import { listMail, unreadMailCount } from "@/services/mail/mail";

export const GET = route({}, async ({ db, user }) => ({ items: await listMail(db, user.id), unread: await unreadMailCount(db, user.id) }));
