import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getProfile } from "@/services/account";
import { Shell } from "@/components/shell/shell";

export default async function OSLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const db = await getDb();
  const { profile, prefs, email } = await getProfile(db, user.id);
  return (
    <Shell
      me={{
        id: user.id,
        email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        timezone: profile.timezone,
        prefs: {
          sidebarCollapsed: prefs.sidebarCollapsed,
          theme: prefs.theme,
          accent: prefs.accent,
          density: prefs.density,
          aiProvider: prefs.aiProvider,
          aiModel: prefs.aiModel,
          memoryEnabled: prefs.memoryEnabled,
        },
      }}
    >
      {children}
    </Shell>
  );
}
