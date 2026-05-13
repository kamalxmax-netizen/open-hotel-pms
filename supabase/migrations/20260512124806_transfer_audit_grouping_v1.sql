-- Transfer Audit Grouping v1.
-- Transfer Audit is an evidence/grouping layer only. Money remains in
-- folio_payments; transfer_events.amount is locked to linked folio rows.

alter table public.transfer_events
  add column if not exists status text not null default 'active',
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null references public.profiles(user_id),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.transfer_events
  drop constraint if exists transfer_events_status_check;

alter table public.transfer_events
  add constraint transfer_events_status_check
  check (status in ('active', 'archived'));

create index if not exists idx_transfer_events_status_recorded
  on public.transfer_events (status, recorded_at desc);

alter table public.folio_payments
  add column if not exists transfer_audit_original_note text null;

create index if not exists idx_folio_payments_transfer_unlinked
  on public.folio_payments (paid_date, paid_at desc)
  where method = 'transfer'::public.payment_method_type
    and transfer_event_id is null;

drop policy if exists transfer_events_update_staff on public.transfer_events;
create policy transfer_events_update_staff on public.transfer_events
for update to authenticated
using (public.has_any_role(array['admin', 'frontdesk', 'supervisor']::public.user_role[]))
with check (public.has_any_role(array['admin', 'frontdesk', 'supervisor']::public.user_role[]));

-- Backfill active status and lock any existing event amount to linked folio rows.
update public.transfer_events
set status = coalesce(nullif(status, ''), 'active'),
    updated_at = timezone('utc', now())
where status is null or status = '';

update public.transfer_events te
set amount = grouped.total_amount,
    updated_at = timezone('utc', now())
from (
  select transfer_event_id, sum(amount)::numeric(12,2) as total_amount
  from public.folio_payments
  where transfer_event_id is not null
  group by transfer_event_id
) grouped
where te.id = grouped.transfer_event_id;

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

  if p_folio_amount is null or p_folio_amount <= 0 then
    raise exception 'folio payment amount must be > 0';
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
    status,
    paid_date,
    sender_name,
    transfer_at,
    amount,
    bank_ref,
    note,
    recorded_by,
    recorded_at,
    updated_at
  )
  values (
    'manual',
    'active',
    p_paid_date,
    nullif(btrim(p_sender_name), ''),
    p_transfer_at,
    p_folio_amount,
    nullif(btrim(p_bank_ref), ''),
    nullif(btrim(p_transfer_note), ''),
    p_recorded_by,
    timezone('utc', now()),
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

comment on column public.transfer_events.status is
  'active or archived. Archived groups keep evidence history but unlink folio rows.';
comment on column public.transfer_events.amount is
  'Locked audit group amount, always computed from linked folio_payments rows.';
comment on column public.folio_payments.transfer_audit_original_note is
  'Original folio note before Transfer Audit auto-sync; restored when unlinked.';
