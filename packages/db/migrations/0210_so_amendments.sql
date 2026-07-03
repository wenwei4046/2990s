-- 0210 — SO amendment / revision workflow (Phase 0, 2026-07-03).
-- A supplier-confirmed, two-gate amendment revises a processing-locked SO and
-- its bound PO in place (same number + revision counter), snapshotting every
-- prior version. Adds the so_amendment_status enum, the so_amendments /
-- so_amendment_lines request tables, the so_revisions / po_revisions snapshot
-- tables, and a `revision` counter column on mfg_sales_orders + purchase_orders.
-- Keyed on so_doc_no (text -> mfg_sales_orders.doc_no) like every other SO child.
-- Apply BEFORE deploying the dependent API/backend code (migrate-before-deploy).
-- Re-run safe.
-- See docs/2026-07-03-so-amendment-workflow-plan.md.

BEGIN;

-- Enum -----------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "public"."so_amendment_status" AS ENUM('REQUESTED', 'SUPPLIER_PENDING', 'SO_APPROVED', 'PO_APPROVED', 'SENT', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Request tables -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "so_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"so_doc_no" text NOT NULL,
	"amendment_no" text NOT NULL,
	"status" "so_amendment_status" DEFAULT 'REQUESTED' NOT NULL,
	"reason" text,
	"requested_by" uuid,
	"supplier_confirmed_by" uuid,
	"supplier_confirmation_ref" text,
	"supplier_confirmation_note" text,
	"supplier_confirmation_attachment_key" text,
	"so_approved_by" uuid,
	"so_approved_at" timestamp with time zone,
	"po_approved_by" uuid,
	"po_approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "so_amendment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amendment_id" uuid NOT NULL,
	"sales_order_item_id" uuid,
	"change_type" text NOT NULL,
	"new_item_code" text,
	"new_variants" jsonb,
	"new_qty" integer,
	"new_unit_price_sen" integer,
	"old_snapshot" jsonb
);

-- Snapshot tables ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "so_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"so_doc_no" text NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"amendment_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "po_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"amendment_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Foreign keys ---------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "so_amendments" ADD CONSTRAINT "so_amendments_so_doc_no_mfg_sales_orders_doc_no_fk" FOREIGN KEY ("so_doc_no") REFERENCES "public"."mfg_sales_orders"("doc_no") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "so_amendments" ADD CONSTRAINT "so_amendments_requested_by_staff_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "so_amendments" ADD CONSTRAINT "so_amendments_supplier_confirmed_by_staff_id_fk" FOREIGN KEY ("supplier_confirmed_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "so_amendments" ADD CONSTRAINT "so_amendments_so_approved_by_staff_id_fk" FOREIGN KEY ("so_approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "so_amendments" ADD CONSTRAINT "so_amendments_po_approved_by_staff_id_fk" FOREIGN KEY ("po_approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "so_amendment_lines" ADD CONSTRAINT "so_amendment_lines_amendment_id_so_amendments_id_fk" FOREIGN KEY ("amendment_id") REFERENCES "public"."so_amendments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Indexes --------------------------------------------------------------------
-- One OPEN amendment per SO (not SENT/REJECTED) — partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_so_amendment_open" ON "so_amendments" USING btree ("so_doc_no") WHERE status NOT IN ('SENT','REJECTED');
CREATE INDEX IF NOT EXISTS "idx_so_amendment_so" ON "so_amendments" USING btree ("so_doc_no");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_so_revision" ON "so_revisions" USING btree ("so_doc_no","revision");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_po_revision" ON "po_revisions" USING btree ("po_id","revision");

-- Revision counter on the live documents --------------------------------------
ALTER TABLE "mfg_sales_orders" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 1 NOT NULL;

COMMIT;
