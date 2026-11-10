"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { HardDrive, Server } from "lucide-react";
import { Segmented } from "@/components/ui/tabs";

/** Bascule Mes fichiers (stockage BASILE OS) / Google Drive. */
export function FilesTabs() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = sp.get("tab") === "drive" ? "drive" : "local";
  return (
    <Segmented
      value={tab}
      onChange={(v) => router.replace(v === "drive" ? "/files?tab=drive" : "/files", { scroll: false })}
      options={[
        { value: "local", label: "Mes fichiers", icon: <Server /> },
        { value: "drive", label: "Google Drive", icon: <HardDrive /> },
      ]}
    />
  );
}
