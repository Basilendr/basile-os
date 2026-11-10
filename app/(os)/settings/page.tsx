import { Suspense } from "react";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata = { title: "Paramètres" };

export default function Page() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}
