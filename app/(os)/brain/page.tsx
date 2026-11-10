import { Suspense } from "react";
import { BrainView } from "@/components/brain/brain-view";

export const metadata = { title: "Second Brain" };

export default function Page() {
  return (
    <Suspense>
      <BrainView />
    </Suspense>
  );
}
