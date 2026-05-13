-- Manual Transfer Detail, single-room v1.
-- Keeps folio_payments as the accounting source while storing bank transfer
-- metadata in transfer_events for audit comparison.

create table if not exists public.transfer_events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual',
  paid_date date not null,
  sender_name text null,
  transfer_at timestamptz null,
  amount numeric(12,2) not null,
  bank_ref text null,
  scb_transaction_id uuid null references public.scb_payment_transactions(id) on delete set null,
  note text null,
  recorded_by uuid null references public.profiles(user_id),
  recorded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.transfer_events
  add column if not exists source text not null default 'manual',
  add column if not exists paid_date date not null default current_date,
  add column if not exists sender_name text null,
  add column if not exists transfer_at timestamptz null,
  add column if not exists amount numeric(12,2) not null default 0,
  add column if not exists bank_ref text null,
  add column if not exists note text null,
  add column if not exists recorded_by uuid null references public.profiles(user_id),
  add column if not exists recorded_at timestamptz not null default timezone('utc', now()),
  add column if not exists created_at timestamptz not null default timezone('utc', now());

do $$
begin
  alter table public.transfer_events
    add constraint transfer_events_source_check
    check (source in ('manual', 'ocr', 'scb_webhook'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.transfer_events
    add constraint transfer_events_amount_check
    check (amount > 0);
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_transfer_events_paid_date
  on public.transfer_events (paid_date);

create index if not exists idx_transfer_events_transfer_at
  on public.transfer_events (transfer_at desc nulls last);

create index if not exists idx_transfer_events_recorded_at
  on public.transfer_events (recorded_at desc);

create index if not exists idx_transfer_events_source
  on public.transfer_events (source);

alter table public.folio_payments
  add column if not exists transfer_event_id uuid null;

do $$
begin
  alter table public.folio_payments
    add constraint folio_payments_transfer_event_id_fkey
    foreign key (transfer_event_id)
    references public.transfer_events(id)
    on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_folio_payments_transfer_event
  on public.folio_payments (transfer_event_id);

alter table public.transfer_events enable row level security;

drop policy if exists transfer_events_select_staff on public.transfer_events;
create policy transfer_events_select_staff on public.transfer_events
for select to authenticated
using (public.has_any_role(array['admin', 'frontdesk', 'supervisor']::public.user_role[]));

drop policy if exists transfer_events_insert_staff on public.transfer_events;
create policy transfer_events_insert_staff on public.transfer_events
for insert to authenticated
with check (public.has_any_role(array['admin', 'frontdesk', 'supervisor']::public.user_role[]));

drop function if exists public.create_manual_transfer_payment(
  uuid,
  public.payment_tx_type,
  public.payment_method_type,
  numeric,
  text,
  text,
  text,
  boolean,
  date,
  timestamptz,
  uuid,
  numeric,
  text,
  text,
  timestamptz,
  text
);

create function public.create_manual_transfer_payment(
  p_reservation_id uuid,
  p_tx_type public.payment_tx_type,
  p_method public.payment_method_type,
  p_folio_amount numeric,
  p_folio_note text,
  p_revenue_category text,
  p_cashier_name text,
  p_is_record_only boolean,
  p_paid_date date,
  p_paid_at timestamptz,
  p_recorded_by uuid,
  p_actual_amount numeric,
  p_sender_name text,
  p_bank_ref text,
  p_transfer_at timestamptz,
  p_transfer_note text
)
returns table(payment_id uuid, transfer_event_id uuid)
language plpgsql
as $$
declare
  v_payment_id uuid;
  v_transfer_event_id uuid;
begin
  if p_method <> 'transfer'::public.payment_method_type then
    raise exception 'manual transfer detail can only be used with transfer method';
  end if;

  if p_actual_amount is null or p_actual_amount <= 0 then
    raise exception 'transfer actual amount must be > 0';
  end if;

  if p_transfer_at is null then
    raise exception 'transfer_at is required';
  end if;

  if p_transfer_at > now() then
    raise exception 'transfer_at cannot be in the future';
  end if;

  insert into public.transfer_events (
    source,
    paid_date,
    sender_name,
    transfer_at,
    amount,
    bank_ref,
    note,
    recorded_by,
    recorded_at
  )
  values (
    'manual',
    p_paid_date,
    nullif(btrim(p_sender_name), ''),
    p_transfer_at,
    p_actual_amount,
    nullif(btrim(p_bank_ref), ''),
    nullif(btrim(p_transfer_note), ''),
    p_recorded_by,
    timezone('utc', now())
  )
  returning id into v_transfer_event_id;

  insert into public.folio_payments (
    reservation_id,
    tx_type,
    method,
    amount,
    note,
    revenue_category,
    cashier_name,
    is_record_only,
    paid_date,
    paid_at,
    recorded_by,
    transfer_event_id
  )
  values (
    p_reservation_id,
    p_tx_type,
    p_method,
    p_folio_amount,
    nullif(btrim(p_folio_note), ''),
    p_revenue_category,
    p_cashier_name,
    coalesce(p_is_record_only, false),
    p_paid_date,
    p_paid_at,
    p_recorded_by,
    v_transfer_event_id
  )
  returning id into v_payment_id;

  return query select v_payment_id, v_transfer_event_id;
end;
$$;

grant execute on function public.create_manual_transfer_payment(
  uuid,
  public.payment_tx_type,
  public.payment_method_type,
  numeric,
  text,
  text,
  text,
  boolean,
  date,
  timestamptz,
  uuid,
  numeric,
  text,
  text,
  timestamptz,
  text
) to authenticated, service_role;

comment on table public.transfer_events is
  'Structured bank transfer metadata used for manual Transfer Audit. Accounting still lives in folio_payments.';
comment on column public.transfer_events.source is
  'manual for staff-entered transfers; ocr/scb_webhook reserved for future automation.';
comment on column public.transfer_events.amount is
  'Actual bank transfer amount before any future allocation/split.';
comment on column public.transfer_events.transfer_at is
  'Customer-side bank transfer timestamp.';
comment on column public.folio_payments.transfer_event_id is
  'Nullable link to structured transfer_events. Null transfer rows are legacy free-text entries.';
