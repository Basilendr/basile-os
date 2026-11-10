import "server-only";
import type { DB } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { getAccessToken } from "./oauth";

/**
 * Appel d'API Google : renouvelle le jeton sur 401, réessaie avec backoff exponentiel
 * sur 429 / 5xx / erreurs réseau, et transforme les erreurs en AppError explicites.
 */
export async function gfetch<T = unknown>(db: DB, userId: string, url: string, init: RequestInit & { raw?: boolean } = {}, attempt = 0, refreshed = false): Promise<T> {
  const token = await getAccessToken(db, userId, refreshed);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    if (attempt < 3) {
      await sleep(400 * 2 ** attempt);
      return gfetch(db, userId, url, init, attempt + 1, refreshed);
    }
    throw new AppError("integration_error", `Google injoignable : ${(e as Error).message}`);
  }
  if (res.status === 401 && !refreshed) return gfetch(db, userId, url, init, attempt, true);
  if ((res.status === 429 || res.status >= 500 || (res.status === 403 && (await peekRateLimited(res)))) && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after")) * 1000 || 500 * 2 ** attempt + Math.random() * 250;
    log.warn("google.retry", { status: res.status, attempt, url: url.split("?")[0] });
    await sleep(Math.min(retryAfter, 8000));
    return gfetch(db, userId, url, init, attempt + 1, refreshed);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = data?.error?.message ?? res.statusText;
    throw new AppError(res.status === 404 ? "not_found" : res.status === 410 ? "conflict" : "integration_error", `Google (${res.status}) : ${message}`, { status: res.status });
  }
  if (init.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function peekRateLimited(res: Response) {
  try {
    const d = await res.clone().json();
    return /rateLimitExceeded|userRateLimitExceeded/.test(JSON.stringify(d?.error?.errors ?? ""));
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exécute des tâches avec une concurrence bornée (respect des quotas). */
export async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}
