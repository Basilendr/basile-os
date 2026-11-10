import { route } from "@/lib/api";
import { syncSchool } from "@/services/school/school";

export const POST = route({ rate: [6, 60_000] }, async ({ db, user }) => syncSchool(db, user.id));
