-- Phase 65 hotfix: water/coffee classification

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
    'phase65 hotfix: reclassified % product row(s)',
    v_updated;
END $$;


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
    'phase65 hotfix: repaired % POS product(s)',
    v_fixed;
END $$;