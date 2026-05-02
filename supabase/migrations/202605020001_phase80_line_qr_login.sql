begin;

create extension if not exists "pgcrypto";

create table if not exists public.line_login_qr_challenges (
  id uuid primary key default gen_random_uuid(),
  qr_token_hash text unique not null,
  desktop_token_hash text unique not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'consumed', 'expired', 'cancelled', 'failed')),
  next_path text not null default '/pms/board',
  staff_id uuid references public.staff(id) on delete set null,
  line_user_id text,
  line_display_name text,
  line_picture_url text,
  failure_reason text,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_line_login_qr_challenges_desktop
  on public.line_login_qr_challenges (desktop_token_hash);

create index if not exists idx_line_login_qr_challenges_pending_expiry
  on public.line_login_qr_challenges (status, expires_at);

create index if not exists idx_line_login_qr_challenges_staff_created
  on public.line_login_qr_challenges (staff_id, created_at desc);

drop trigger if exists trg_line_login_qr_challenges_updated_at on public.line_login_qr_challenges;
create trigger trg_line_login_qr_challenges_updated_at
before update on public.line_login_qr_challenges
for each row execute function public.set_updated_at();

alter table public.line_login_qr_challenges enable row level security;

drop policy if exists line_login_qr_challenges_service_role_full_access on public.line_login_qr_challenges;
create policy line_login_qr_challenges_service_role_full_access
  on public.line_login_qr_challenges
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

commit;
