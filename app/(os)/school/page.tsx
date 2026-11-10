import { Suspense } from "react";
import { SchoolView } from "@/components/school/school-view";

export const metadata = { title: "École" };

export default function Page() {
  return (
    <Suspense>
      <SchoolView />
    </Suspense>
  );
}
