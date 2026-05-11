alter table public.hotel_settings
  add column if not exists urgent_overlay_enabled boolean not null default false;

notify pgrst, 'reload schema';
