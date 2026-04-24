-- Phase 75 · Batch 3 · RLS baseline ROLLBACK
-- Date: 2026-04-24
-- Owner: Lead (skeleton) + Agent B (body fill)
--
-- ⚠️ LOCATION: This file lives OUTSIDE supabase/migrations/ on purpose.
--    Placing it in migrations/ would cause Supabase CLI to auto-apply it
--    immediately after 009, undoing the RLS enable. Keep it here as
--    a manual runbook artifact.
--
-- WHEN TO USE: Apply ONLY if 202604240009 causes a production anomaly
-- that cannot be resolved by adding an additional policy.
--
-- HOW TO APPLY (manual, Lead-authorized only):
--   1. Confirm incident: what query is failing, on which table?
--   2. Prefer incremental fix: add a missing INSERT/UPDATE policy first.
--   3. If full rollback needed: `psql $DB_URL -f supabase/rollback/phase75/202604240010_phase75_rls_rollback.sql`
--   4. Record the rollback in PHASE75_DIFF_SUMMARY.md + LEAD_SIGNOFF.
--
-- Rollback is symmetric to 202604240009: for each table,
--   DROP POLICY IF EXISTS <table>_authenticated_read ON public.<table>;
--   ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;
--
-- Order is reverse of forward migration (11 → 1) to minimize dependency hazard.

BEGIN;

-- ============================================================================
-- 11. maid_cart_items
-- ============================================================================
-- TODO(Agent B): DROP POLICY IF EXISTS ... + DISABLE ROW LEVEL SECURITY

-- ============================================================================
-- 10. stock_transactions
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 9. stock_items
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 8. extra_task_assignments
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 7. extra_task_templates
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 6. checklist_templates
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 5. daily_plans
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 4. booking_groups
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 3. rate_plan_profiles
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 2. rate_plan_tiers
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 1. rate_plans
-- ============================================================================
-- TODO(Agent B)

COMMIT;
