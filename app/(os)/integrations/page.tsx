import { Suspense } from "react";
import { IntegrationsView } from "@/components/settings/integrations-view";

export const metadata = { title: "Intégrations" };

export default function Page() {
  return (
    <Suspense>
      <IntegrationsView />
    </Suspense>
  );
}
