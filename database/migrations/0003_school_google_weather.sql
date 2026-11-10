CREATE TABLE "instance_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"value_enc" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'ecoledirecte' NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"token_enc" text,
	"fa_enc" text,
	"account_id" integer,
	"account_type" text,
	"student_id" integer,
	"student_name" text,
	"school_name" text,
	"class_name" text,
	"school_year" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"pending_qcm" jsonb,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"subject" text NOT NULL,
	"title" text NOT NULL,
	"kind" text,
	"value" text,
	"out_of" text DEFAULT '20' NOT NULL,
	"coef" text DEFAULT '1' NOT NULL,
	"date" date NOT NULL,
	"period" text,
	"class_average" text,
	"non_significant" boolean DEFAULT false NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_homework" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"subject" text NOT NULL,
	"subject_code" text,
	"title" text DEFAULT '' NOT NULL,
	"content_html" text,
	"due_date" date NOT NULL,
	"given_date" date,
	"is_test" boolean DEFAULT false NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"teacher" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"subject" text NOT NULL,
	"subject_code" text,
	"teacher" text,
	"room" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"color" text,
	"kind" text DEFAULT 'COURS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"external_id" integer NOT NULL,
	"folder" text DEFAULT 'received' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"content_html" text,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_states" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "purpose" text DEFAULT 'connect' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "weather_city" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "weather_lat" double precision;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "weather_lon" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" text;--> statement-breakpoint
ALTER TABLE "instance_secrets" ADD CONSTRAINT "instance_secrets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_accounts" ADD CONSTRAINT "school_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_grades" ADD CONSTRAINT "school_grades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_homework" ADD CONSTRAINT "school_homework_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_lessons" ADD CONSTRAINT "school_lessons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_messages" ADD CONSTRAINT "school_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "school_grades_ext_uq" ON "school_grades" USING btree ("user_id","source","external_id");--> statement-breakpoint
CREATE INDEX "school_grades_date_idx" ON "school_grades" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "school_homework_ext_uq" ON "school_homework" USING btree ("user_id","source","external_id");--> statement-breakpoint
CREATE INDEX "school_homework_due_idx" ON "school_homework" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "school_lessons_ext_uq" ON "school_lessons" USING btree ("user_id","source","external_id");--> statement-breakpoint
CREATE INDEX "school_lessons_start_idx" ON "school_lessons" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "school_messages_uq" ON "school_messages" USING btree ("user_id","folder","external_id");--> statement-breakpoint
CREATE INDEX "school_messages_date_idx" ON "school_messages" USING btree ("user_id","date");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub");