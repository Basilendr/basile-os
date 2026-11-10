import { route } from "@/lib/api";
import { getProfile } from "@/services/account";

export const GET = route({}, async ({ db, user }) => {
  const { profile, prefs, email } = await getProfile(db, user.id);
  return { id: user.id, email, profile, prefs };
});
