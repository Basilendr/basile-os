"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useHydrated } from "./use-hydrated";

export type ServiceState = { status: "connected" | "disconnected" | "error"; lastSyncAt?: string | null; lastError?: string | null; accountEmail?: string | null };
export type Status = {
  ai: { configured: boolean; provider: string; model?: string };
  google: { configured: boolean; services: Record<"gmail" | "calendar" | "drive" | "contacts", ServiceState> };
  unreadNotifications: number;
};

/**
 * État des connexions. Les pages hydratent après la barre supérieure : la donnée peut déjà être
 * en cache à ce moment-là, on ne l'expose donc qu'une fois l'hydratation terminée.
 */
export function useStatus() {
  const q = useQuery({ queryKey: ["status"], queryFn: () => api.get<Status>("/api/status"), refetchInterval: 60_000 });
  const hydrated = useHydrated();
  return hydrated ? q : { ...q, data: undefined };
}
