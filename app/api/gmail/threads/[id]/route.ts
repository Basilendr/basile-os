import { z } from "zod";
import { route } from "@/lib/api";
import { getThread } from "@/services/google/gmail";

export const GET = route({}, async ({ db, user, params }) => ({ messages: await getThread(db, user.id, z.string().max(64).parse(params.id)) }));
