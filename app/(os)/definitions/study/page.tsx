import { Suspense } from "react";
import { DefStudy } from "@/components/definitions/study";

export const metadata = { title: "Révision des définitions" };

export default function Page() {
  return (
    <Suspense>
      <DefStudy />
    </Suspense>
  );
}
