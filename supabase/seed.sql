BEGIN;

-- =========================================================
-- 1. Restore the required room types
-- =========================================================

INSERT INTO public.room_types (
  code,
  name_en,
  name_local,
  sort_order
)
VALUES
  ('DD', 'Deluxe Double Room', 'Deluxe Double Room', 20),
  ('DT', 'Deluxe Triple Room', 'Deluxe Triple Room', 30),
  ('CLOSED', 'Maintenance', 'Maintenance', 999)
ON CONFLICT (code) DO UPDATE
SET
  name_en = EXCLUDED.name_en,
  name_local = EXCLUDED.name_local,
  sort_order = EXCLUDED.sort_order;


-- =========================================================
-- 2. Restore the 16 actual rooms
-- =========================================================

INSERT INTO public.rooms (
  room_number,
  room_type_id,
  is_sellable,
  is_visible_on_board,
  closure_reason,
  sort_order,
  is_dayuse
)
VALUES
  -- Deluxe Triple Rooms
  ('105', (SELECT id FROM public.room_types WHERE code = 'DT'), true, true, null, 1, false),
  ('106', (SELECT id FROM public.room_types WHERE code = 'DT'), true, true, null, 2, false),
  ('107', (SELECT id FROM public.room_types WHERE code = 'DT'), true, true, null, 3, false),
  ('205', (SELECT id FROM public.room_types WHERE code = 'DT'), true, true, null, 4, false),

  -- Deluxe Double Rooms - Day Use enabled
  ('102', (SELECT id FROM public.room_types WHERE code = 'DD'), true, true, null, 5, true),
  ('103', (SELECT id FROM public.room_types WHERE code = 'DD'), true, true, null, 6, true),
  ('104', (SELECT id FROM public.room_types WHERE code = 'DD'), true, true, null, 7, true),
  ('201', (SELECT id FROM public.room_types WHERE code = 'DD'), true, true, null, 8, true),
  ('202', (SELECT id FROM public.room_types WHERE code = 'DD'), true, true, null, 9, true),

  -- Deluxe Double Rooms - normal overnight only
  ('108', (SELECT id FROM public.room_types WHERE code = 'DD'), true, true, null, 10, false),
  ('109', (SELECT id FROM public.room_types WHERE code = 'DD'), true, true, null, 11, false),
  ('206', (SELECT id FROM public.room_types WHERE code = 'DD'), true, true, null, 12, false),
  ('207', (SELECT id FROM public.room_types WHERE code = 'DD'), true, true, null, 13, false),
  ('208', (SELECT id FROM public.room_types WHERE code = 'DD'), true, true, null, 14, false),

  -- Maintenance
  ('203', (SELECT id FROM public.room_types WHERE code = 'CLOSED'), false, true, 'Maintenance', 101, false),
  ('204', (SELECT id FROM public.room_types WHERE code = 'CLOSED'), false, true, 'Maintenance', 102, false)

ON CONFLICT (room_number) DO UPDATE
SET
  room_type_id = EXCLUDED.room_type_id,
  is_sellable = EXCLUDED.is_sellable,
  is_visible_on_board = EXCLUDED.is_visible_on_board,
  closure_reason = EXCLUDED.closure_reason,
  sort_order = EXCLUDED.sort_order,
  is_dayuse = EXCLUDED.is_dayuse,
  updated_at = timezone('utc', now());

COMMIT;
