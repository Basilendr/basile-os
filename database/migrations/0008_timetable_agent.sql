CREATE TABLE "school_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"message_id" uuid,
	"date" date NOT NULL,
	"end_date" date NOT NULL,
	"action" text NOT NULL,
	"start_time" text,
	"end_time" text,
	"match_start" text,
	"match_subject" text,
	"subject" text,
	"teacher" text,
	"room" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_gcal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"google_id" text NOT NULL,
	"hash" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "school_accounts" ADD COLUMN "gcal_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "school_accounts" ADD COLUMN "gcal_id" text;--> statement-breakpoint
ALTER TABLE "school_accounts" ADD COLUMN "gcal_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_accounts" ADD COLUMN "gcal_error" text;--> statement-breakpoint
ALTER TABLE "school_messages" ADD COLUMN "agent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_messages" ADD COLUMN "agent_note" text;--> statement-breakpoint
ALTER TABLE "school_changes" ADD CONSTRAINT "school_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_changes" ADD CONSTRAINT "school_changes_message_id_school_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."school_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_gcal_events" ADD CONSTRAINT "school_gcal_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_changes_date_idx" ON "school_changes" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "school_gcal_events_uq" ON "school_gcal_events" USING btree ("user_id","key");