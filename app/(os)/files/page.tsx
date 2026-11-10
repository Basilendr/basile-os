import { Suspense } from "react";
import { FilesView } from "@/components/files/files-view";

export const metadata = { title: "Fichiers" };

export default function Page() {
  return (
    <Suspense>
      <FilesView />
    </Suspense>
  );
}
