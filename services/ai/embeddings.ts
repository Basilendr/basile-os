import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { env } from "@/lib/env";
import { secret } from "@/lib/secrets";
import { sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { rowsOf } from "@/lib/sql";

type Provider = { name: "openai" | "voyage"; model: string; dims: number };

/** Fournisseur d'embeddings configuré (aucun repli simulé : sans clé, la recherche sémantique est indisponible). */
export function embeddingsProvider(): Provider | null {
  const pref = env.EMBEDDINGS_PROVIDER;
  if (pref === "none") return null;
  if ((pref === "voyage" || !pref) && secret("VOYAGE_API_KEY")) return { name: "voyage", model: "voyage-3.5", dims: 1024 };
  if ((pref === "openai" || !pref) && secret("OPENAI_API_KEY")) return { name: "openai", model: "text-embedding-3-small", dims: 1536 };
  return null;
}

export async function embed(texts: string[], kind: "document" | "query" = "document"): Promise<{ vectors: number[][]; model: string }> {
  const p = embeddingsProvider();
  if (!p) throw new AppError("not_configured", "Aucun fournisseur d'embeddings configuré (VOYAGE_API_KEY ou OPENAI_API_KEY).");
  const input = texts.map((t) => t.slice(0, 8000));
  if (p.name === "openai") {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { authorization: `Bearer ${secret("OPENAI_API_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({ model: p.model, input }),
      signal: AbortSignal.timeout(30_000),
    });
    const d = await res.json();
    if (!res.ok) throw new AppError("integration_error", `Embeddings OpenAI : ${d?.error?.message ?? res.status}`);
    return { vectors: d.data.map((x: { embedding: number[] }) => x.embedding), model: p.model };
  }
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${secret("VOYAGE_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({ model: p.model, input, input_type: kind }),
    signal: AbortSignal.timeout(30_000),
  });
  const d = await res.json();
  if (!res.ok) throw new AppError("integration_error", `Embeddings Voyage : ${d?.detail ?? res.status}`);
  return { vectors: d.data.map((x: { embedding: number[] }) => x.embedding), model: p.model };
}

/** Découpage en segments ~1200 caractères avec chevauchement, sur les limites de paragraphes. */
export function chunk(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(clean.length, i + size);
    if (end < clean.length) {
      const br = clean.lastIndexOf("\n", end);
      if (br > i + size / 2) end = br;
    }
    out.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = end - overlap;
  }
  return out.filter(Boolean);
}

/** Indexe (ou réindexe si le contenu a changé) une entité. Ignore silencieusement si aucun fournisseur. */
export async function indexEntity(db: DB, userId: string, entityType: string, entityId: string, text: string) {
  const p = embeddingsProvider();
  if (!p) return { indexed: 0, skipped: "no_provider" as const };
  const chunks = chunk(text);
  const existing = await db
    .select({ chunkIndex: schema.embeddings.chunkIndex, hash: schema.embeddings.contentHash })
    .from(schema.embeddings)
    .where(and(eq(schema.embeddings.userId, userId), eq(schema.embeddings.entityType, entityType), eq(schema.embeddings.entityId, entityId), eq(schema.embeddings.model, p.model)));
  const known = new Map(existing.map((e) => [e.chunkIndex, e.hash]));
  const todo = chunks.map((c, i) => ({ c, i, h: sha256(c) })).filter((x) => known.get(x.i) !== x.h);
  if (todo.length) {
    const { vectors, model } = await embed(todo.map((t) => t.c));
    for (const [k, t] of todo.entries()) {
      const v = { userId, entityType, entityId, chunkIndex: t.i, content: t.c, contentHash: t.h, model, dims: vectors[k].length, embedding: vectors[k] };
      await db
        .insert(schema.embeddings)
        .values(v)
        .onConflictDoUpdate({ target: [schema.embeddings.userId, schema.embeddings.entityType, schema.embeddings.entityId, schema.embeddings.chunkIndex, schema.embeddings.model], set: v });
    }
  }
  await db.execute(
    sql`delete from ${schema.embeddings} where user_id = ${userId} and entity_type = ${entityType} and entity_id = ${entityId} and chunk_index >= ${chunks.length}`,
  );
  return { indexed: todo.length };
}

export async function removeEntity(db: DB, userId: string, entityType: string, entityId: string) {
  await db
    .delete(schema.embeddings)
    .where(and(eq(schema.embeddings.userId, userId), eq(schema.embeddings.entityType, entityType), eq(schema.embeddings.entityId, entityId)));
}

export type SemanticHit = { entityType: string; entityId: string; content: string; score: number };

/** Recherche vectorielle (distance cosinus pgvector) — un résultat par entité, le meilleur segment. */
export async function semanticSearch(db: DB, userId: string, query: string, opts: { limit?: number; types?: string[] } = {}): Promise<SemanticHit[]> {
  const p = embeddingsProvider();
  if (!p) throw new AppError("not_configured", "La recherche sémantique nécessite un fournisseur d'embeddings (VOYAGE_API_KEY ou OPENAI_API_KEY).");
  const { vectors, model } = await embed([query], "query");
  const vec = `[${vectors[0].join(",")}]`;
  const typeFilter = opts.types?.length ? sql`and entity_type in (${sql.join(opts.types.map((t) => sql`${t}`), sql`, `)})` : sql``;
  const res = await db.execute(sql`
    select distinct on (entity_type, entity_id) entity_type, entity_id, content, 1 - (embedding <=> ${vec}::vector) as score
    from ${schema.embeddings}
    where user_id = ${userId} and model = ${model} ${typeFilter}
    order by entity_type, entity_id, embedding <=> ${vec}::vector`);
  return rowsOf<{ entity_type: string; entity_id: string; content: string; score: number }>(res)
    .map((r) => ({ entityType: r.entity_type, entityId: r.entity_id, content: r.content, score: Number(r.score) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 10);
}

/** Réindexation complète des sources du Second Brain. */
export async function reindexAll(db: DB, userId: string) {
  if (!embeddingsProvider()) throw new AppError("not_configured", "Aucun fournisseur d'embeddings configuré.");
  let n = 0;
  const notes = await db.select({ id: schema.notes.id, title: schema.notes.title, text: schema.notes.contentText }).from(schema.notes).where(eq(schema.notes.userId, userId));
  for (const x of notes) n += (await indexEntity(db, userId, "note", x.id, `${x.title}\n\n${x.text}`)).indexed;
  const files = await db.select({ id: schema.files.id, name: schema.files.name, text: schema.files.textContent }).from(schema.files).where(and(eq(schema.files.userId, userId), sql`${schema.files.textContent} is not null`));
  for (const x of files) n += (await indexEntity(db, userId, "file", x.id, `${x.name}\n\n${x.text}`)).indexed;
  const items = await db.select().from(schema.knowledgeItems).where(eq(schema.knowledgeItems.userId, userId));
  for (const x of items) n += (await indexEntity(db, userId, "knowledge", x.id, `${x.title}\n\n${x.content}`)).indexed;
  const projects = await db.select().from(schema.projects).where(eq(schema.projects.userId, userId));
  for (const x of projects) n += (await indexEntity(db, userId, "project", x.id, `${x.name}\n\n${x.description}`)).indexed;
  log.info("embeddings.reindexed", { userId, chunks: n });
  return { chunks: n };
}
