-- Phase 75 · Batch 3 · RLS baseline on 11 no-RLS tables
-- Date: 2026-04-24
-- Owner: Lead (skeleton) + Agent B (body fill)
-- Risk: LOW — Agent A confirmed client-side reads go through API routes (service_role bypasses RLS).
--              Permissive SELECT policy for authenticated keeps any future anon-key path working too.
--
-- Pattern per table (MUST be idempotent):
--   ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS <table>_authenticated_read ON public.<table>;
--   CREATE POLICY <table>_authenticated_read
--     ON public.<table>
--     FOR SELECT
--     TO authenticated
--     USING (true);
--
-- No INSERT/UPDATE/DELETE policies — writes remain service-role-only (existing behavior).
--
-- Rollback: run 202604240010_phase75_rls_rollback.sql (prepared but NOT applied).

BEGIN;

-- ============================================================================
-- 1. rate_plans
-- ============================================================================
-- TODO(Agent B): ALTER TABLE + DROP POLICY IF EXISTS + CREATE POLICY (read-to-authenticated)

-- ============================================================================
-- 2. rate_plan_tiers
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 3. rate_plan_profiles
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 4. booking_groups
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 5. daily_plans
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 6. checklist_templates
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 7. extra_task_templates
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 8. extra_task_assignments
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 9. stock_items
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 10. stock_transactions
-- ============================================================================
-- TODO(Agent B)

-- ============================================================================
-- 11. maid_cart_items
-- ============================================================================
-- TODO(Agent B)

COMMIT;
