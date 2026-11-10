import { route } from "@/lib/api";
import { SettingsInput, getSettings, saveSettings } from "@/services/quiz/quiz";

export const GET = route({}, async ({ db, user }) => getSettings(db, user.id));
export const PUT = route({ body: SettingsInput }, async ({ db, user, body }) => saveSettings(db, user.id, body));
