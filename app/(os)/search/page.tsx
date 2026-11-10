import { Suspense } from "react";
import { SearchView } from "@/components/shell/search-view";

export const metadata = { title: "Recherche" };

export default function Page() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
