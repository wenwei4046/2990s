-- 0129_pwp_rules_allow_multiple.sql
-- Chairman 2026-06-02: PWP needs MULTIPLE rules per category pair, differentiated
-- by model lists — e.g. two MATTRESS→BEDFRAME rules (Mattress A → Aria;
-- Mattress B → Orient). The 0128 one-active-per-pair unique index blocked the
-- second active rule. Drop it so differentiated rules coexist. Idempotent.
DROP INDEX IF EXISTS pwp_rules_one_active_per_pair;
