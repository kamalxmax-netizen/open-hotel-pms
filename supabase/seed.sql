-- Room type seed
insert into public.room_types (code, name_en, name_local, sort_order)
values
  ('TS', 'Twin Standard', 'Twin Standard (2 points)', 10),
  ('DS', 'Double Standard', 'Double Standard (1 point)', 20),
  ('DQ', 'Deluxe Queen', 'Deluxe Queen', 30),
  ('DT', 'Deluxe Twin', 'Deluxe Twin', 40),
  ('JS', 'Junior Suite', 'Junior Suite', 50),
  ('TB', 'Triple Beds', 'Triple Beds', 60),
  ('FR', 'Family Room', 'Family Room', 70),
  ('CLOSED', 'Closed Room', 'Closed / Renovation', 999)
on conflict (code) do update
set
  name_en = excluded.name_en,
  name_local = excluded.name_local,
  sort_order = excluded.sort_order;

-- Sellable rooms (from current ROOM_MAP)
insert into public.rooms (
  room_number,
  room_type_id,
  is_sellable,
  is_visible_on_board,
  closure_reason,
  sort_order
)
values
  ('101', (select id from public.room_types where code = 'TS'), true, true, null, 1),
  ('102', (select id from public.room_types where code = 'TS'), true, true, null, 2),
  ('103', (select id from public.room_types where code = 'DS'), true, true, null, 3),
  ('104', (select id from public.room_types where code = 'DS'), true, true, null, 4),
  ('105', (select id from public.room_types where code = 'DT'), true, true, null, 5),
  ('106', (select id from public.room_types where code = 'DQ'), true, true, null, 6),
  ('107', (select id from public.room_types where code = 'FR'), true, true, null, 7),
  ('201', (select id from public.room_types where code = 'TS'), true, true, null, 8),
  ('202', (select id from public.room_types where code = 'TS'), true, true, null, 9),
  ('203', (select id from public.room_types where code = 'DS'), true, true, null, 10),
  ('204', (select id from public.room_types where code = 'DT'), true, true, null, 11),
  ('205', (select id from public.room_types where code = 'JS'), true, true, null, 12),
  ('206', (select id from public.room_types where code = 'TB'), true, true, null, 13),
  ('207', (select id from public.room_types where code = 'DQ'), true, true, null, 14),
  ('208', (select id from public.room_types where code = 'FR'), true, true, null, 15),
  ('209', (select id from public.room_types where code = 'DS'), true, true, null, 16),
  ('210', (select id from public.room_types where code = 'DS'), true, true, null, 17),
  ('211', (select id from public.room_types where code = 'JS'), true, true, null, 18),
  -- Non-sellable but visible (maintenance)
  ('108', (select id from public.room_types where code = 'CLOSED'), false, true, 'Maintenance', 101),
  ('212', (select id from public.room_types where code = 'CLOSED'), false, true, 'Maintenance', 102)
on conflict (room_number) do update
set
  room_type_id = excluded.room_type_id,
  is_sellable = excluded.is_sellable,
  is_visible_on_board = excluded.is_visible_on_board,
  closure_reason = excluded.closure_reason,
  sort_order = excluded.sort_order;

-- Base layout rows. Coordinates will be refined using the imported building plan mapping.
insert into public.room_layouts (room_id, view_type, grid_x, grid_y, zone, sort_order)
select id, 'month', null, null, 'building', sort_order
from public.rooms
on conflict (room_id, view_type) do update
set
  zone = excluded.zone,
  sort_order = excluded.sort_order;

insert into public.room_layouts (room_id, view_type, grid_x, grid_y, zone, sort_order)
select id, 'week', null, null, 'building', sort_order
from public.rooms
on conflict (room_id, view_type) do update
set
  zone = excluded.zone,
  sort_order = excluded.sort_order;

insert into public.room_layouts (room_id, view_type, grid_x, grid_y, zone, sort_order)
select id, 'day', null, null, 'building', sort_order
from public.rooms
on conflict (room_id, view_type) do update
set
  zone = excluded.zone,
  sort_order = excluded.sort_order;

-- Seed default pricing templates (last 30 days to next 365 days)
with date_range as (
  select generate_series(current_date - interval '30 day', current_date + interval '365 day', interval '1 day')::date as stay_date
),
sellable_rooms as (
  select r.id as room_id, rt.code as room_type_code
  from public.rooms r
  join public.room_types rt on rt.id = r.room_type_id
  where r.is_sellable = true
),
base_prices as (
  select
    dr.stay_date,
    sr.room_id,
    case sr.room_type_code
      when 'TS' then 1000
      when 'DS' then 1000
      when 'DQ' then 1200
      when 'DT' then 1200
      when 'JS' then 1800
      when 'TB' then 1500
      when 'FR' then 2000
      else 1000
    end::numeric(10, 2) as price
  from date_range dr
  cross join sellable_rooms sr
)
insert into public.rate_templates (stay_date, room_id, price)
select
  stay_date,
  room_id,
  price
from base_prices
on conflict (stay_date, room_id) do update
set
  price = excluded.price;
