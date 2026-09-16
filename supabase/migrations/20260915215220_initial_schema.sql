CREATE TYPE "public"."analysis_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."analysis_trigger" AS ENUM('MANUAL', 'PUSH', 'SCHEDULE', 'CLI');--> statement-breakpoint
CREATE TYPE "public"."gate_operator" AS ENUM('GT', 'LT', 'WORSE_THAN');--> statement-breakpoint
CREATE TYPE "public"."gate_scope" AS ENUM('OVERALL', 'NEW_CODE');--> statement-breakpoint
CREATE TYPE "public"."gate_status" AS ENUM('PASSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('OPEN', 'CONFIRMED', 'REOPENED', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."issue_type" AS ENUM('BUG', 'VULNERABILITY', 'CODE_SMELL', 'SECURITY_HOTSPOT');--> statement-breakpoint
CREATE TYPE "public"."repository_provider" AS ENUM('GITHUB', 'GITLAB', 'LOCAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."resolution" AS ENUM('FIXED', 'FALSE_POSITIVE', 'WONT_FIX', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO');--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "analysis_status" DEFAULT 'PENDING' NOT NULL,
	"trigger" "analysis_trigger" DEFAULT 'MANUAL' NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"commit_sha" text,
	"commit_message" text,
	"commit_author" text,
	"committed_at" timestamp with time zone,
	"version" text,
	"baseline_analysis_id" uuid,
	"gate_status" "gate_status",
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "file_measures" (
	"analysis_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"language" text NOT NULL,
	"ncloc" integer DEFAULT 0 NOT NULL,
	"issue_count" integer DEFAULT 0 NOT NULL,
	"effort_minutes" integer DEFAULT 0 NOT NULL,
	"coverage" real,
	"duplicated_lines_density" real,
	"complexity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "file_measures_analysis_id_file_path_pk" PRIMARY KEY("analysis_id","file_path")
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"type" "issue_type" NOT NULL,
	"severity" "severity" NOT NULL,
	"status" "issue_status" DEFAULT 'OPEN' NOT NULL,
	"resolution" "resolution",
	"file_path" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"start_column" integer,
	"end_column" integer,
	"message" text NOT NULL,
	"effort_minutes" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"flow" jsonb,
	"assignee" text,
	"is_new_code" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "measures" (
	"analysis_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"value" real NOT NULL,
	"new_code_value" real,
	CONSTRAINT "measures_analysis_id_metric_pk" PRIMARY KEY("analysis_id","metric")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"provider" "repository_provider" DEFAULT 'LOCAL' NOT NULL,
	"repository_url" text,
	"local_path" text,
	"main_branch" text DEFAULT 'main' NOT NULL,
	"access_token" text,
	"webhook_secret" text,
	"analyze_on_push" boolean DEFAULT true NOT NULL,
	"quality_gate_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_analyzed_at" timestamp with time zone,
	CONSTRAINT "projects_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "quality_gate_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gate_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"operator" "gate_operator" NOT NULL,
	"threshold" real NOT NULL,
	"scope" "gate_scope" DEFAULT 'NEW_CODE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_gates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"languages" text[] DEFAULT '{}' NOT NULL,
	"type" "issue_type" NOT NULL,
	"default_severity" "severity" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"effort_minutes" integer DEFAULT 5 NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_measures" ADD CONSTRAINT "file_measures_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_rule_key_rules_key_fk" FOREIGN KEY ("rule_key") REFERENCES "public"."rules"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measures" ADD CONSTRAINT "measures_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_quality_gate_id_quality_gates_id_fk" FOREIGN KEY ("quality_gate_id") REFERENCES "public"."quality_gates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gate_conditions" ADD CONSTRAINT "quality_gate_conditions_gate_id_quality_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."quality_gates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_project_started_idx" ON "analyses" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "file_measures_effort_idx" ON "file_measures" USING btree ("analysis_id","effort_minutes");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_project_fingerprint_idx" ON "issues" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "issues_project_status_idx" ON "issues" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "issues_analysis_idx" ON "issues" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "issues_file_idx" ON "issues" USING btree ("project_id","file_path");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_gate_conditions_gate_metric_scope_idx" ON "quality_gate_conditions" USING btree ("gate_id","metric","scope");