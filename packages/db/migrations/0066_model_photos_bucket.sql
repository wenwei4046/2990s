-- ----------------------------------------------------------------------------
-- 0066 — Supabase Storage bucket for Product Model photos (PR — Commander
-- 2026-05-26).
--
-- Commander asked for photo upload on the Modular tab's Model detail page
-- ("可以放照片的啊，为什么不能放呢"). product_models.photo_url already
-- exists (migration 0062). This migration:
--
--   1. Creates a PUBLIC bucket 'model-photos' (5MB cap, common image types).
--   2. Grants signed-in staff INSERT / UPDATE / DELETE on objects inside
--      that bucket. Public read so <img src="..."> works without signing.
--
-- Why public read: Model photos are catalogue assets — they show up on
-- quotations / printouts / customer-facing surfaces eventually. Anyone
-- with the URL can view; only staff can write. This matches the role
-- pattern on the rest of the catalogue (mfg_products is readable by all
-- staff; products is readable by anyone via the future POS).
-- ----------------------------------------------------------------------------

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'model-photos',
  'model-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Drop-and-recreate so re-running the migration is idempotent. Storage
-- policies are simple — bucket scope only, no per-row claim checks needed
-- since the bucket is intentionally staff-write / world-read.
DROP POLICY IF EXISTS model_photos_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS model_photos_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS model_photos_authenticated_delete ON storage.objects;
DROP POLICY IF EXISTS model_photos_public_select       ON storage.objects;

CREATE POLICY model_photos_authenticated_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'model-photos');

CREATE POLICY model_photos_authenticated_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'model-photos')
  WITH CHECK (bucket_id = 'model-photos');

CREATE POLICY model_photos_authenticated_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'model-photos');

CREATE POLICY model_photos_public_select ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'model-photos');

COMMIT;
