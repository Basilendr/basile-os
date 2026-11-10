import { Suspense } from "react";
import { CalendarView } from "@/components/calendar/calendar-view";

export const metadata = { title: "Calendrier" };

export default function Page() {
  return (
    <Suspense>
      <CalendarView />
    </Suspense>
  );
}
