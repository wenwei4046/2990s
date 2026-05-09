-- 0013_storage_bucket_dos.sql
-- Phase 4 sub-project C: private Supabase Storage bucket for signed DO files.
-- Coordinator+ uploads + reads via Supabase JS direct (no API mediation needed).
-- DELETE restricted to admin (audit material).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dos', 'dos', false, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "dos_select_coord"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'dos' AND public.is_coordinator_or_above());

CREATE POLICY "dos_insert_coord"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dos' AND public.is_coordinator_or_above());

CREATE POLICY "dos_update_coord"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'dos' AND public.is_coordinator_or_above())
  WITH CHECK (bucket_id = 'dos' AND public.is_coordinator_or_above());

CREATE POLICY "dos_delete_admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'dos' AND public.is_admin());
