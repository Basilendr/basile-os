import { after } from "next/server";
import { route } from "@/lib/api";
import { syncSchool } from "@/services/school/school";
import { afterSchoolSync } from "@/services/school/pipeline";

export const POST = route({ rate: [6, 60_000] }, async ({ db, user }) => {
  const r = await syncSchool(db, user.id);
  after(() => afterSchoolSync(db, user.id));
  return r;
});
