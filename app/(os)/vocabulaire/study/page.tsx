import { Suspense } from "react";
import { Study } from "@/components/flashcards/study";

export const metadata = { title: "Révision du vocabulaire" };

export default function Page() {
  return (
    <Suspense>
      <Study />
    </Suspense>
  );
}
