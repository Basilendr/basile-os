import { route } from "@/lib/api";
import { FolderInput, createFolder, listFolders } from "@/services/notes";

export const GET = route({}, async ({ db, user }) => ({ items: await listFolders(db, user.id) }));
export const POST = route({ body: FolderInput }, async ({ db, user, body }) => createFolder(db, user.id, body));
