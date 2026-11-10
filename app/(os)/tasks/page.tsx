import { Suspense } from "react";
import { TasksView } from "@/components/tasks/tasks-view";

export const metadata = { title: "Tâches" };

export default function Page() {
  return (
    <Suspense>
      <TasksView />
    </Suspense>
  );
}
