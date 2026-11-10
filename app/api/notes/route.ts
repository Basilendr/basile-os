import { route } from "@/lib/api";
import { NoteCreate, NoteQuery, createNote, listNotes } from "@/services/notes";

export const GET = route({ query: NoteQuery }, async ({ db, user, query }) => ({ items: await listNotes(db, user.id, query) }));
export const POST = route({ body: NoteCreate }, async ({ db, user, body }) => createNote(db, user.id, body));
