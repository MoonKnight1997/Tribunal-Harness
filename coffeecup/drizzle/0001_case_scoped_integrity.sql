-- 0001_case_scoped_integrity
--
-- Order matters: the composite unique indexes must exist BEFORE the composite
-- foreign keys that reference them. Pre-existing rows whose process/candidate/
-- document belongs to a different case than the child row will make the
-- ADD CONSTRAINT statements fail; run `npm run db:check-integrity` first
-- (scripts/check-integrity.ts) to list and repair them. Rollback SQL is in
-- drizzle/rollback/0001_case_scoped_integrity.down.sql.
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "allegations" ADD COLUMN "source_quote" text;
--> statement-breakpoint
ALTER TABLE "allegations" ADD COLUMN "source_location" jsonb;
--> statement-breakpoint
ALTER TABLE "allegations" ADD COLUMN "quote_verified" boolean;
--> statement-breakpoint
ALTER TABLE "allegations" ADD COLUMN "proposed_by_job_id" text;
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "generation" jsonb;
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "review_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "user_edited_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "generated_content" text;
--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "computed_for_date" date;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "extraction_report" jsonb;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "page_count" integer;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "process_id" text;
--> statement-breakpoint
ALTER TABLE "employment_relationships" ADD COLUMN "start_date_precision" text DEFAULT 'exact' NOT NULL;
--> statement-breakpoint
ALTER TABLE "employment_relationships" ADD COLUMN "end_date_precision" text DEFAULT 'exact' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_quote" text;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_location" jsonb;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "quote_verified" boolean;
--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "value_precision" text DEFAULT 'exact' NOT NULL;
--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "source_quote" text;
--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "source_location" jsonb;
--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "quote_verified" boolean;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "locked_by" text;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "next_run_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "cancelled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "payment_ref" text;
--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "processing_status" text DEFAULT 'received' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "last_error" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reason" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "dismissed_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "claim_candidates_id_case_idx" ON "claim_candidates" USING btree ("id","case_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "documents_id_case_idx" ON "documents" USING btree ("id","case_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_payment_ref_idx" ON "entitlements" USING btree ("payment_ref") WHERE payment_ref is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_idx" ON "jobs" USING btree ("idempotency_key") WHERE idempotency_key is not null;
--> statement-breakpoint
CREATE INDEX "payment_events_ref_idx" ON "payment_events" USING btree ("payment_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "processes_id_case_idx" ON "processes" USING btree ("id","case_id");
--> statement-breakpoint
ALTER TABLE "allegations" ADD CONSTRAINT "allegations_process_case_fk" FOREIGN KEY ("process_id","case_id") REFERENCES "public"."processes"("id","case_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appeal_grounds" ADD CONSTRAINT "appeal_grounds_process_case_fk" FOREIGN KEY ("process_id","case_id") REFERENCES "public"."processes"("id","case_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "claim_elements" ADD CONSTRAINT "claim_elements_candidate_case_fk" FOREIGN KEY ("claim_candidate_id","case_id") REFERENCES "public"."claim_candidates"("id","case_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_doc_case_fk" FOREIGN KEY ("document_id","case_id") REFERENCES "public"."documents"("id","case_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Data migration: existing webhook rows that were fully applied are 'processed'; the rest stay 'received' and are retried.
UPDATE "payment_events" SET "processing_status" = 'processed' WHERE "processed_at" IS NOT NULL;
--> statement-breakpoint
-- Data migration: structured date facts recorded from intake as approximate carried the flag only in prose. Preserve it as data.
UPDATE "facts" SET "value_precision" = 'approximate' WHERE "key" IS NOT NULL AND "statement" LIKE '%(approximate)%';
--> statement-breakpoint
-- Data migration: documents that were uploaded against a process are re-linked from the job payload so reprocessing keeps the context.
UPDATE "documents" d SET "process_id" = j.payload->>'processId' FROM "jobs" j WHERE j.type = 'document.extract' AND j.payload->>'documentId' = d.id AND j.payload->>'processId' IS NOT NULL AND d."process_id" IS NULL AND EXISTS (SELECT 1 FROM "processes" p WHERE p.id = j.payload->>'processId' AND p.case_id = d.case_id);
