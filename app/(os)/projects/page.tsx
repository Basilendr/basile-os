import { Suspense } from "react";
import { ProjectsView } from "@/components/projects/projects-view";

export const metadata = { title: "Projets" };

export default function Page() {
  return (
    <Suspense>
      <ProjectsView />
    </Suspense>
  );
}
