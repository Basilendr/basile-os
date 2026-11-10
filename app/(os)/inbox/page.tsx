import { Suspense } from "react";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata = { title: "Boîte de réception" };

export default function Page() {
  return (
    <Suspense>
      <InboxView />
    </Suspense>
  );
}
