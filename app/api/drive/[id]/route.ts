import { z } from "zod";
import { route } from "@/lib/api";
import { getDriveFile } from "@/services/google/drive";

export const GET = route({}, async ({ db, user, params }) => getDriveFile(db, user.id, z.string().regex(/^[\w-]{5,200}$/).parse(params.id)));
