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
DROP POLICY IF EXISTS maid_cart_items_authenticated_read ON public.maid_cart_items;
ALTER TABLE public.maid_cart_items DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 10. stock_transactions
-- ============================================================================
DROP POLICY IF EXISTS stock_transactions_authenticated_read ON public.stock_transactions;
ALTER TABLE public.stock_transactions DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 9. stock_items
-- ============================================================================
DROP POLICY IF EXISTS stock_items_authenticated_read ON public.stock_items;
ALTER TABLE public.stock_items DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 8. extra_task_assignments
-- ============================================================================
DROP POLICY IF EXISTS extra_task_assignments_authenticated_read ON public.extra_task_assignments;
ALTER TABLE public.extra_task_assignments DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 7. extra_task_templates
-- ============================================================================
DROP POLICY IF EXISTS extra_task_templates_authenticated_read ON public.extra_task_templates;
ALTER TABLE public.extra_task_templates DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 6. checklist_templates
-- ============================================================================
DROP POLICY IF EXISTS checklist_templates_authenticated_read ON public.checklist_templates;
ALTER TABLE public.checklist_templates DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. daily_plans
-- ============================================================================
DROP POLICY IF EXISTS daily_plans_authenticated_read ON public.daily_plans;
ALTER TABLE public.daily_plans DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. booking_groups
-- ============================================================================
DROP POLICY IF EXISTS booking_groups_authenticated_read ON public.booking_groups;
ALTER TABLE public.booking_groups DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. rate_plan_profiles
-- ============================================================================
DROP POLICY IF EXISTS rate_plan_profiles_authenticated_read ON public.rate_plan_profiles;
ALTER TABLE public.rate_plan_profiles DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. rate_plan_tiers
-- ============================================================================
DROP POLICY IF EXISTS rate_plan_tiers_authenticated_read ON public.rate_plan_tiers;
ALTER TABLE public.rate_plan_tiers DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 1. rate_plans
-- ============================================================================
DROP POLICY IF EXISTS rate_plans_authenticated_read ON public.rate_plans;
ALTER TABLE public.rate_plans DISABLE ROW LEVEL SECURITY;

COMMIT;
