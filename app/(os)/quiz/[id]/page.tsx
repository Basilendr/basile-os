import { QuizPlayer } from "@/components/quiz/quiz-player";

export const metadata = { title: "Quiz" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuizPlayer id={id} />;
}
