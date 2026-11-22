CREATE TABLE "def_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords_by" text DEFAULT 'auto' NOT NULL,
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
CREATE TABLE "def_decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"subject" text,
	"source" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"focus" text,
	"text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"error" text,
	"keywords_status" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "def_cards" ADD CONSTRAINT "def_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "def_cards" ADD CONSTRAINT "def_cards_deck_id_def_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."def_decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "def_decks" ADD CONSTRAINT "def_decks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "def_cards_deck_idx" ON "def_cards" USING btree ("deck_id","position");--> statement-breakpoint
CREATE INDEX "def_cards_due_idx" ON "def_cards" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "def_decks_user_idx" ON "def_decks" USING btree ("user_id","created_at");