import "server-only";
import { z } from "zod";

/** Variables d'environnement côté serveur — jamais exposées au navigateur. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3100"),
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default(".data"),
  ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  EMBEDDINGS_PROVIDER: z.enum(["openai", "voyage", "none"]).optional(),
  DISABLE_SCHEDULER: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  /** "db" : contenu des fichiers en base (hébergement sans disque permanent). Automatique sur Vercel. */
  FILE_STORAGE: z.enum(["disk", "db"]).optional(),
  VERCEL: z.string().optional(),
});

export const env = schema.parse(process.env);

/** Serveur sans processus permanent ni disque (Vercel). */
export const serverless = !!env.VERCEL;

export { googleConfigured } from "./secrets";
