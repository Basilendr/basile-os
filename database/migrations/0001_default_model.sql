ALTER TABLE "user_preferences" ALTER COLUMN "ai_model" SET DEFAULT 'claude-opus-5-5';--> statement-breakpoint
UPDATE "user_preferences" SET "ai_model" = 'claude-opus-5-5' WHERE "ai_model" = 'claude-sonnet-5-5';
