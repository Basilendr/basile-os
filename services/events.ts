import "server-only";
import type { DB } from "@/lib/db";
import { log } from "@/lib/log";

/**
 * Bus d'événements interne : chaque module publie ses événements métier
 * (task.completed, email.received, event.created…) ; le moteur d'automatisation
 * et les agents s'y abonnent. Les écouteurs ne bloquent jamais l'appelant.
 */
export type AppEvent = {
  type: string;
  userId: string;
  entityType?: string;
  entityId?: string;
  data: Record<string, unknown>;
  /** Identifiant stable pour l'idempotence (évite les exécutions en double). */
  key: string;
};

type Listener = (db: DB, e: AppEvent) => Promise<void>;
const g = globalThis as unknown as { __basileListeners?: Listener[] };
const listeners: Listener[] = (g.__basileListeners ??= []);

export function subscribe(fn: Listener) {
  if (!listeners.includes(fn)) listeners.push(fn);
}

export async function emit(db: DB, e: AppEvent) {
  for (const fn of listeners) {
    try {
      await fn(db, e);
    } catch (err) {
      log.error("event.listener_failed", { type: e.type, error: String(err) });
    }
  }
}
