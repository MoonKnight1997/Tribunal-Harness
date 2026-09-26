-- Rollback for 0001_case_scoped_integrity. Reverses schema additions only;
-- data written into the new columns is lost on rollback (it is derived or
-- diagnostic data, never the only copy of a user's record). Run inside a
-- transaction. After running, delete the 0001 entry from drizzle/meta/_journal.json
-- and the row from the drizzle "__drizzle_migrations" table if re-applying later.
ALTER TABLE "allegations" DROP CONSTRAINT IF EXISTS "allegations_process_case_fk";
ALTER TABLE "appeal_grounds" DROP CONSTRAINT IF EXISTS "appeal_grounds_process_case_fk";
ALTER TABLE "claim_elements" DROP CONSTRAINT IF EXISTS "claim_elements_candidate_case_fk";
ALTER TABLE "document_links" DROP CONSTRAINT IF EXISTS "document_links_doc_case_fk";
DROP INDEX IF EXISTS "claim_candidates_id_case_idx";
DROP INDEX IF EXISTS "documents_id_case_idx";
DROP INDEX IF EXISTS "entitlements_payment_ref_idx";
DROP INDEX IF EXISTS "jobs_idempotency_idx";
DROP INDEX IF EXISTS "payment_events_ref_idx";
DROP INDEX IF EXISTS "processes_id_case_idx";
ALTER TABLE "allegations" DROP COLUMN IF EXISTS "source_quote", DROP COLUMN IF EXISTS "source_location", DROP COLUMN IF EXISTS "quote_verified", DROP COLUMN IF EXISTS "proposed_by_job_id";
ALTER TABLE "artifacts" DROP COLUMN IF EXISTS "generation", DROP COLUMN IF EXISTS "review_flags", DROP COLUMN IF EXISTS "user_edited_at", DROP COLUMN IF EXISTS "generated_content";
ALTER TABLE "deadlines" DROP COLUMN IF EXISTS "computed_for_date";
ALTER TABLE "documents" DROP COLUMN IF EXISTS "extraction_report", DROP COLUMN IF EXISTS "page_count", DROP COLUMN IF EXISTS "process_id";
ALTER TABLE "employment_relationships" DROP COLUMN IF EXISTS "start_date_precision", DROP COLUMN IF EXISTS "end_date_precision";
ALTER TABLE "events" DROP COLUMN IF EXISTS "source_quote", DROP COLUMN IF EXISTS "source_location", DROP COLUMN IF EXISTS "quote_verified";
ALTER TABLE "facts" DROP COLUMN IF EXISTS "value_precision", DROP COLUMN IF EXISTS "source_quote", DROP COLUMN IF EXISTS "source_location", DROP COLUMN IF EXISTS "quote_verified";
ALTER TABLE "jobs" DROP COLUMN IF EXISTS "lease_expires_at", DROP COLUMN IF EXISTS "locked_by", DROP COLUMN IF EXISTS "next_run_at", DROP COLUMN IF EXISTS "cancelled_at", DROP COLUMN IF EXISTS "idempotency_key";
ALTER TABLE "payment_events" DROP COLUMN IF EXISTS "payment_ref", DROP COLUMN IF EXISTS "processing_status", DROP COLUMN IF EXISTS "attempts", DROP COLUMN IF EXISTS "last_error";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "reason", DROP COLUMN IF EXISTS "priority", DROP COLUMN IF EXISTS "dismissed_at";
DROP TABLE IF EXISTS "rate_limits";
