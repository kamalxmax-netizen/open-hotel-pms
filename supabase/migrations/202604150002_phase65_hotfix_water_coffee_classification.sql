-- Phase 65 hotfix — 2026-04-15
-- Problem: 202604150001 backfill used exact name match
-- Actual product names in the catalog are:
--   - "Water Bottle For Room" (amenity, should be amenity_prepare)
--   - "Coffee For Room"       (amenity, should be amenity_prepare)
--   - "Water Bottle For Sale" (POS, should remain pos_main_only)
--   - "Coffee"                (POS, should remain pos_main_only)
--
-- This hotfix only changes active products currently classified
-- as amenity_direct.

DO $$
DECLARE
  v_updated INT;
BEGIN

  UPDATE public.products
  SET
    stock_tracking_mode = 'amenity_prepare',
    updated_at = timezone('utc', now())
  WHERE is_active = true
    AND stock_tracking_mode = 'amenity_direct'
    AND lower(trim(name)) IN (
      'water bottle for room',
      'coffee for room'
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RAISE NOTICE
    'phase65 hotfix: reclassified % product row(s) from amenity_direct to amenity_prepare',
    v_updated;

END $$;


-- Defensive sweep:
-- Active POS products must use pos_main_only.

DO $$
DECLARE
  v_fixed INT;
BEGIN

  UPDATE public.products
  SET
    stock_tracking_mode = 'pos_main_only',
    updated_at = timezone('utc', now())
  WHERE is_active = true
    AND category = 'pos'
    AND stock_tracking_mode <> 'pos_main_only';

  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  RAISE NOTICE
    'phase65 hotfix: repaired % POS product(s) to pos_main_only',
    v_fixed;

END $$;