import { Hammer } from "lucide-react";
import { EmptyState, PageHeader } from "./misc";

/** État honnête pour un module dont la phase de développement n'est pas encore livrée. */
export function ModulePending({ title, phase, description }: { title: string; phase: number; description: string }) {
  return (
    <div className="mx-auto max-w-[1200px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader title={title} />
      <div className="surface">
        <EmptyState icon={<Hammer className="size-5" />} title={`Module en construction — phase ${phase}`} description={description} />
      </div>
    </div>
  );
}
