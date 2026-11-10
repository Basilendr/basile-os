import { Suspense } from "react";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata = { title: "Analyses personnelles" };

export default function Page() {
  return (
    <Suspense>
      <AnalyticsView />
    </Suspense>
  );
}
