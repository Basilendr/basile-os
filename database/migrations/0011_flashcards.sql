CREATE TABLE "flash_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"term" text NOT NULL,
	"translation" text NOT NULL,
	"example" text,
	"example_fr" text,
	"note" text,
	"kind" text,
	"position" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"interval" integer DEFAULT 0 NOT NULL,
	"ease" integer DEFAULT 250 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flash_decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"subject" text,
	"lang" text DEFAULT 'en' NOT NULL,
	"source" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"focus" text,
	"text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"error" text,
	"guide" jsonb,
	"guide_status" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flash_cards" ADD CONSTRAINT "flash_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flash_cards" ADD CONSTRAINT "flash_cards_deck_id_flash_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."flash_decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flash_decks" ADD CONSTRAINT "flash_decks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flash_cards_deck_idx" ON "flash_cards" USING btree ("deck_id","position");--> statement-breakpoint
CREATE INDEX "flash_cards_due_idx" ON "flash_cards" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "flash_decks_user_idx" ON "flash_decks" USING btree ("user_id","created_at");