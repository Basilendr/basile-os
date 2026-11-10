/** Résultat de `db.execute` : tableau (postgres-js) ou { rows } (PGlite). */
export function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows: T[] }).rows ?? []);
}
