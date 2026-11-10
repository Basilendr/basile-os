import { Suspense } from "react";
import { QuizView } from "@/components/quiz/quiz-view";

export const metadata = { title: "Quiz" };

export default function Page() {
  return (
    <Suspense>
      <QuizView />
    </Suspense>
  );
}
