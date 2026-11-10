import { Suspense } from "react";
import { AutomationsView } from "@/components/automations/automations-view";

export const metadata = { title: "Automatisations" };

export default function Page() {
  return (
    <Suspense>
      <AutomationsView />
    </Suspense>
  );
}
