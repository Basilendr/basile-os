import { Suspense } from "react";
import { AssistantView } from "@/components/assistant/assistant-view";

export const metadata = { title: "Assistant IA" };

export default function Page() {
  return (
    <Suspense>
      <AssistantView />
    </Suspense>
  );
}
