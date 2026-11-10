import { Suspense } from "react";
import { CommandCenter } from "@/components/assistant/command-center";

export const metadata = { title: "Centre de commande" };

export default function Page() {
  return (
    <Suspense>
      <CommandCenter />
    </Suspense>
  );
}
