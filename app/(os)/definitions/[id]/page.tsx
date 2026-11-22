import { Suspense } from "react";
import { DefDeckView } from "@/components/definitions/deck-view";

export const metadata = { title: "Définitions" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <DefDeckView id={id} />
    </Suspense>
  );
}
