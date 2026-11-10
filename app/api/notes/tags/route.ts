import { route } from "@/lib/api";
import { noteTags } from "@/services/notes";

export const GET = route({}, async ({ db, user }) => ({ items: await noteTags(db, user.id) }));
