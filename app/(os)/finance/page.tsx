import { Suspense } from "react";
import { FinanceView } from "@/components/finance/finance-view";

export const metadata = { title: "Finances" };

export default function Page() {
  return (
    <Suspense>
      <FinanceView />
    </Suspense>
  );
}
