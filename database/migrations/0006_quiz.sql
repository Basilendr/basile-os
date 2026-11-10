CREATE TABLE "quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"quiz_id" uuid NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quiz_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"question" jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"box" integer DEFAULT 1 NOT NULL,
	"due_date" date NOT NULL,
	"lapses" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"drive_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"modified_time" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"base_text" text,
	"text_date" date,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"weekday_hour" integer DEFAULT 18 NOT NULL,
	"wednesday_hour" integer DEFAULT 14 NOT NULL,
	"weekend_hour" integer DEFAULT 10 NOT NULL,
	"question_count" integer DEFAULT 10 NOT NULL,
	"folder_id" text,
	"folder_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"subject" text,
	"status" text DEFAULT 'generating' NOT NULL,
	"for_date" date NOT NULL,
	"homework_id" uuid,
	"stage" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"key_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"tries" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "school_homework" ADD COLUMN "quiz_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_cards" ADD CONSTRAINT "quiz_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_documents" ADD CONSTRAINT "quiz_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_settings" ADD CONSTRAINT "quiz_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_homework_id_school_homework_id_fk" FOREIGN KEY ("homework_id") REFERENCES "public"."school_homework"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quiz_attempts_quiz_idx" ON "quiz_attempts" USING btree ("user_id","quiz_id");--> statement-breakpoint
CREATE INDEX "quiz_attempts_done_idx" ON "quiz_attempts" USING btree ("user_id","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_cards_uq" ON "quiz_cards" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "quiz_cards_due_idx" ON "quiz_cards" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_documents_uq" ON "quiz_documents" USING btree ("user_id","drive_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quizzes_dedupe_uq" ON "quizzes" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "quizzes_date_idx" ON "quizzes" USING btree ("user_id","for_date");--> statement-breakpoint
CREATE INDEX "quizzes_homework_idx" ON "quizzes" USING btree ("homework_id");