begin;

-- Monthly vendor statements use a separate token scope from per-batch vendor flows.
-- Expiry is controlled by API code at the next Bangkok month boundary.
create table if not exists public.laundry_monthly_vendor_tokens (
  id uuid primary key default gen_random_uuid(),
  year smallint not null check (year between 2020 and 2100),
  month smallint not null check (month between 1 and 12),
  token uuid not null default gen_random_uuid() unique,
  vendor_name text,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_laundry_monthly_vendor_tokens_token
  on public.laundry_monthly_vendor_tokens (token);

create index if not exists idx_laundry_monthly_vendor_tokens_period
  on public.laundry_monthly_vendor_tokens (year, month, created_at desc);

create unique index if not exists idx_laundry_monthly_vendor_tokens_one_active_period
  on public.laundry_monthly_vendor_tokens (year, month)
  where revoked = false;

drop trigger if exists trg_laundry_monthly_vendor_tokens_updated_at on public.laundry_monthly_vendor_tokens;
create trigger trg_laundry_monthly_vendor_tokens_updated_at
before update on public.laundry_monthly_vendor_tokens
for each row execute function public.set_updated_at();

alter table public.laundry_monthly_vendor_tokens enable row level security;

drop policy if exists laundry_monthly_vendor_tokens_auth on public.laundry_monthly_vendor_tokens;
create policy laundry_monthly_vendor_tokens_auth on public.laundry_monthly_vendor_tokens
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists laundry_monthly_vendor_tokens_service_role on public.laundry_monthly_vendor_tokens;
create policy laundry_monthly_vendor_tokens_service_role on public.laundry_monthly_vendor_tokens
  for all to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on public.laundry_monthly_vendor_tokens to authenticated, service_role;

-- Monthly summary billing is N + O. Rewash is stored separately and remains ฿0.
create or replace function public.fn_linen_monthly_summary(p_year int, p_month int)
returns table (
  linen_item_id int,
  item_number smallint,
  name_th text,
  name_en text,
  rate numeric,
  qty_sent bigint,
  qty_returned bigint,
  qty_pending bigint,
  qty_extra bigint,
  qty_dayuse bigint,
  total_baht numeric
)
language sql
stable
as $$
  with bounds as (
    select make_date(p_year, p_month, 1) as start_date,
           (make_date(p_year, p_month, 1) + interval '1 month')::date as end_date
  ),
  item_agg as (
    select
      i.linen_item_id,
      sum(case when i.is_dayuse is false then i.sent_by_hotel else 0 end)::bigint as qty_sent,
      sum(case when i.is_dayuse is false then i.received_back else 0 end)::bigint as qty_returned,
      sum(case when i.is_dayuse is false and li.item_number in (1, 2)
          then greatest(i.sent_by_hotel - i.estimated_qty, 0)
          else 0 end)::bigint as qty_extra,
      sum(case when i.is_dayuse is true then i.sent_by_hotel else 0 end)::bigint as qty_dayuse
    from public.laundry_batches b
    join public.laundry_batch_items i on i.batch_id = b.id
    join public.linen_items li on li.id = i.linen_item_id
    cross join bounds
    where b.business_date >= bounds.start_date
      and b.business_date < bounds.end_date
    group by i.linen_item_id
  )
  select
    li.id as linen_item_id,
    li.item_number,
    li.name_th,
    li.name_en,
    public.fn_linen_rate(li.id, bounds.start_date) as rate,
    coalesce(a.qty_sent, 0) as qty_sent,
    coalesce(a.qty_returned, 0) as qty_returned,
    greatest(coalesce(a.qty_sent, 0) - coalesce(a.qty_returned, 0), 0) as qty_pending,
    coalesce(a.qty_extra, 0) as qty_extra,
    coalesce(a.qty_dayuse, 0) as qty_dayuse,
    (
      public.fn_linen_rate(li.id, bounds.start_date)
      * (coalesce(a.qty_sent, 0) + coalesce(a.qty_dayuse, 0))
    )::numeric(12, 2) as total_baht
  from public.linen_items li
  cross join bounds
  left join item_agg a on a.linen_item_id = li.id
  order by li.item_number;
$$;

grant execute on function public.fn_linen_monthly_summary(int, int) to authenticated, service_role;

commit;
