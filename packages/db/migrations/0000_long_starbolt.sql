CREATE TYPE "public"."addon_kind" AS ENUM('qty', 'floors_items', 'flat');--> statement-breakpoint
CREATE TYPE "public"."comp_group" AS ENUM('1-seater', '2-seater', 'Corner', 'L-Shape', 'Accessory');--> statement-breakpoint
CREATE TYPE "public"."order_item_kind" AS ENUM('product', 'addon');--> statement-breakpoint
CREATE TYPE "public"."order_lane" AS ENUM('received', 'proceed', 'logistics', 'ready', 'dispatched', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('deposit', 'balance', 'topup', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('credit', 'debit', 'installment', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."pricing_kind" AS ENUM('size_variants', 'sofa_build', 'flat', 'tbc');--> statement-breakpoint
CREATE TYPE "public"."slip_state" AS ENUM('none', 'pending', 'verified', 'flagged');--> statement-breakpoint
CREATE TYPE "public"."slip_upload_status" AS ENUM('pending', 'uploaded', 'promoted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('sales', 'showroom_lead', 'coordinator', 'finance', 'admin');--> statement-breakpoint
CREATE TABLE "addons" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"icon" text NOT NULL,
	"kind" "addon_kind" NOT NULL,
	"price" integer NOT NULL,
	"per_floor_item" integer,
	"unit" text,
	"default_qty" integer DEFAULT 1 NOT NULL,
	"stock" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "bundle_library" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sub" text NOT NULL,
	"signature" text NOT NULL,
	"base_width_cm" integer NOT NULL,
	"base_depth_cm" integer NOT NULL,
	"cushions" integer NOT NULL,
	"default_price" integer NOT NULL,
	"art_left" text,
	"art_right" text,
	"art_base" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"icon" text NOT NULL,
	"tbc" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compartment_library" (
	"id" text PRIMARY KEY NOT NULL,
	"comp_group" "comp_group" NOT NULL,
	"label" text NOT NULL,
	"width_cm" integer NOT NULL,
	"depth_cm" integer NOT NULL,
	"cushions" integer DEFAULT 1 NOT NULL,
	"default_price" integer NOT NULL,
	"art_filename" text,
	"is_accessory" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"postcode" text,
	"city" text,
	"state" text,
	"notes" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"ic_number" text,
	"vehicle" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_driver_code_unique" UNIQUE("driver_code")
);
--> statement-breakpoint
CREATE TABLE "my_localities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"postcode" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"state_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"kind" "order_item_kind" NOT NULL,
	"product_id" uuid,
	"addon_id" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_price" integer NOT NULL,
	"line_total" integer NOT NULL,
	"config" jsonb,
	"floors_count" integer,
	"items_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_or_addon" CHECK (
    ("order_items"."kind" = 'product' AND "order_items"."product_id" IS NOT NULL AND "order_items"."addon_id" IS NULL) OR
    ("order_items"."kind" = 'addon'   AND "order_items"."addon_id"   IS NOT NULL AND "order_items"."product_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "order_lane_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"from_lane" "order_lane",
	"to_lane" "order_lane" NOT NULL,
	"changed_by" uuid NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_slip_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"event" text NOT NULL,
	"actor_id" uuid,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staff_id" uuid NOT NULL,
	"showroom_id" uuid NOT NULL,
	"lane" "order_lane" DEFAULT 'received' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"customer_email" text,
	"customer_address" text,
	"customer_postcode" text,
	"customer_city" text,
	"customer_state" text,
	"emergency_name" text,
	"emergency_phone" text,
	"emergency_relation" text,
	"customer_id" uuid,
	"subtotal" integer NOT NULL,
	"addon_total" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"pricing_version" text NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"approval_code" text,
	"slip_state" "slip_state" DEFAULT 'none' NOT NULL,
	"slip_key" text,
	"slip_verified_by" uuid,
	"slip_verified_at" timestamp with time zone,
	"slip_flag_reason" text,
	"delivery_date" date,
	"delivery_slot" text,
	"delivery_tbd" boolean DEFAULT false NOT NULL,
	"delivery_notes" text,
	"driver_id" uuid,
	"confirmed_with" text,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"do_signed" boolean DEFAULT false NOT NULL,
	"notes" text,
	"stock_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"amount" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"approval_code" text,
	"slip_key" text,
	"slip_state" "slip_state" DEFAULT 'none' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "pending_slip_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_session_id" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"showroom_id" uuid NOT NULL,
	"order_draft_id" text,
	"r2_key" text NOT NULL,
	"content_type" text,
	"content_hash" text,
	"content_size" integer,
	"status" "slip_upload_status" DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_msg" text,
	"claimed_by" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"promoted_at" timestamp with time zone,
	"promoted_to_order_id" text,
	CONSTRAINT "pending_slip_uploads_upload_session_id_unique" UNIQUE("upload_session_id")
);
--> statement-breakpoint
CREATE TABLE "product_bundles" (
	"product_id" uuid NOT NULL,
	"bundle_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"price" integer NOT NULL,
	CONSTRAINT "product_bundles_product_id_bundle_id_pk" PRIMARY KEY("product_id","bundle_id")
);
--> statement-breakpoint
CREATE TABLE "product_compartments" (
	"product_id" uuid NOT NULL,
	"compartment_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"price" integer NOT NULL,
	CONSTRAINT "product_compartments_product_id_compartment_id_pk" PRIMARY KEY("product_id","compartment_id")
);
--> statement-breakpoint
CREATE TABLE "product_size_variants" (
	"product_id" uuid NOT NULL,
	"size_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"price" integer NOT NULL,
	CONSTRAINT "product_size_variants_product_id_size_id_pk" PRIMARY KEY("product_id","size_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"category_id" text NOT NULL,
	"series_id" text,
	"pricing_kind" "pricing_kind" DEFAULT 'tbc' NOT NULL,
	"name" text NOT NULL,
	"detail" text,
	"size_display" text,
	"img_key" text,
	"thumb_key" text,
	"stock" integer DEFAULT 0 NOT NULL,
	"low_at" integer DEFAULT 5 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"flat_price" integer,
	"recliner_upgrade_price" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "pricing_consistency" CHECK (
    ("products"."pricing_kind" = 'flat'         AND "products"."flat_price" IS NOT NULL) OR
    ("products"."pricing_kind" = 'sofa_build'   AND "products"."recliner_upgrade_price" IS NOT NULL) OR
    ("products"."pricing_kind" IN ('size_variants','tbc'))
  )
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"showroom_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"customer_email" text,
	"cart" jsonb NOT NULL,
	"addons" jsonb,
	"subtotal" integer NOT NULL,
	"addon_total" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"pricing_version" text NOT NULL,
	"expires_at" timestamp with time zone,
	"promoted_to_order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "showrooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"showroom_code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "showrooms_showroom_code_unique" UNIQUE("showroom_code")
);
--> statement-breakpoint
CREATE TABLE "size_library" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"width_cm" integer NOT NULL,
	"length_cm" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_code" text NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"showroom_id" uuid,
	"pin_hash" text,
	"email" text,
	"phone" text,
	"initials" text NOT NULL,
	"color" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_staff_code_unique" UNIQUE("staff_code"),
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_addon_id_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."addons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lane_history" ADD CONSTRAINT "order_lane_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lane_history" ADD CONSTRAINT "order_lane_history_changed_by_staff_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_slip_events" ADD CONSTRAINT "order_slip_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_slip_events" ADD CONSTRAINT "order_slip_events_actor_id_staff_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_showroom_id_showrooms_id_fk" FOREIGN KEY ("showroom_id") REFERENCES "public"."showrooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_slip_verified_by_staff_id_fk" FOREIGN KEY ("slip_verified_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_slip_uploads" ADD CONSTRAINT "pending_slip_uploads_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_slip_uploads" ADD CONSTRAINT "pending_slip_uploads_showroom_id_showrooms_id_fk" FOREIGN KEY ("showroom_id") REFERENCES "public"."showrooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_slip_uploads" ADD CONSTRAINT "pending_slip_uploads_promoted_to_order_id_orders_id_fk" FOREIGN KEY ("promoted_to_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bundles" ADD CONSTRAINT "product_bundles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bundles" ADD CONSTRAINT "product_bundles_bundle_id_bundle_library_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundle_library"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_compartments" ADD CONSTRAINT "product_compartments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_compartments" ADD CONSTRAINT "product_compartments_compartment_id_compartment_library_id_fk" FOREIGN KEY ("compartment_id") REFERENCES "public"."compartment_library"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_size_variants" ADD CONSTRAINT "product_size_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_size_variants" ADD CONSTRAINT "product_size_variants_size_id_size_library_id_fk" FOREIGN KEY ("size_id") REFERENCES "public"."size_library"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_updated_by_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_showroom_id_showrooms_id_fk" FOREIGN KEY ("showroom_id") REFERENCES "public"."showrooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_promoted_to_order_id_orders_id_fk" FOREIGN KEY ("promoted_to_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_showroom_id_showrooms_id_fk" FOREIGN KEY ("showroom_id") REFERENCES "public"."showrooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customers_phone" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_my_localities_postcode" ON "my_localities" USING btree ("postcode");--> statement-breakpoint
CREATE INDEX "idx_my_localities_state" ON "my_localities" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_order_items_order" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_order_lane_history_order" ON "order_lane_history" USING btree ("order_id","changed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_orders_lane" ON "orders" USING btree ("lane");--> statement-breakpoint
CREATE INDEX "idx_orders_showroom" ON "orders" USING btree ("showroom_id");--> statement-breakpoint
CREATE INDEX "idx_orders_slip_state" ON "orders" USING btree ("slip_state") WHERE "orders"."slip_state" IN ('pending','flagged');--> statement-breakpoint
CREATE INDEX "idx_orders_placed_at" ON "orders" USING btree ("placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_payments_order" ON "payments" USING btree ("order_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_pending_slip_reaper" ON "pending_slip_uploads" USING btree ("status","expires_at") WHERE "pending_slip_uploads"."status" IN ('pending','uploaded');--> statement-breakpoint
CREATE INDEX "idx_pending_slip_staff" ON "pending_slip_uploads" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "idx_pending_slip_session" ON "pending_slip_uploads" USING btree ("upload_session_id");--> statement-breakpoint
CREATE INDEX "idx_products_visible" ON "products" USING btree ("visible") WHERE "products"."visible" = TRUE;--> statement-breakpoint
CREATE INDEX "idx_products_category" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_quotes_created_by" ON "quotes" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_quotes_showroom" ON "quotes" USING btree ("showroom_id");