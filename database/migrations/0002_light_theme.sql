ALTER TABLE "user_preferences" ALTER COLUMN "theme" SET DEFAULT 'light';--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "accent" SET DEFAULT '#0071E3';--> statement-breakpoint
UPDATE "user_preferences" SET "theme" = 'light', "accent" = '#0071E3' WHERE "theme" = 'dark' AND "accent" = '#6385FF';
