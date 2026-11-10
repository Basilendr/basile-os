import { Suspense } from "react";
import { NotesView } from "@/components/notes/notes-view";

export const metadata = { title: "Notes" };

export default function Page() {
  return (
    <Suspense>
      <NotesView />
    </Suspense>
  );
}
