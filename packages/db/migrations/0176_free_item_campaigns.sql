-- 0176_free_item_campaigns.sql
-- Standalone "Free Item Campaign": while active, eligible cart lines can be made
-- RM0 by the salesperson (no qualifying purchase). eligible = per-Model; sofa may
-- target a specific combo. Distinct from per-Model GWP (model_default_free_gifts).
CREATE TABLE IF NOT EXISTS free_item_campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  active       boolean NOT NULL DEFAULT false,
  max_free_qty integer NOT NULL DEFAULT 1 CHECK (max_free_qty >= 1),
  eligible     jsonb   NOT NULL DEFAULT '[]'::jsonb,
               -- [{ modelId, scope: 'model'|'combo', comboId? }]
  created_by   uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE free_item_campaigns IS
  'Standalone free-item giveaway campaigns (no qualifying purchase). eligible jsonb = per-Model; sofa scope model|combo.';

ALTER TABLE free_item_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY fic_select_all ON free_item_campaigns
  FOR SELECT TO authenticated USING (true);
CREATE POLICY fic_write_editors ON free_item_campaigns
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')));
