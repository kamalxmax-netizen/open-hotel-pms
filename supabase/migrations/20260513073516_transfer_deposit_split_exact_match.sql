-- Exact-match Transfer Detail split:
-- one manual transfer event creates a room payment row and a deposit row.
-- The API still owns the decision; this RPC keeps the DB insert atomic.

drop function if exists public.create_manual_transfer_payment_with_deposit_split(
  uuid,
  numeric,
  numeric,
  text,
  text,
  date,
  timestamptz,
  uuid,
  numeric,
  text,
  text,
  timestamptz,
  text
);

create function public.create_manual_transfer_payment_with_deposit_split(
  p_reservation_id uuid,
  p_folio_amount numeric,
  p_deposit_amount numeric,
  p_folio_note text,
  p_cashier_name text,
  p_paid_date date,
  p_paid_at timestamptz,
  p_recorded_by uuid,
  p_actual_amount numeric,
  p_sender_name text,
  p_bank_ref text,
  p_transfer_at timestamptz,
  p_transfer_note text
)
returns table(payment_id uuid, deposit_payment_id uuid, transfer_event_id uuid)
language plpgsql
as $$
declare
  v_payment_id uuid;
  v_deposit_payment_id uuid;
  v_transfer_event_id uuid;
  v_folio_amount numeric(12,2) := round(coalesce(p_folio_amount, 0)::numeric, 2);
  v_deposit_amount numeric(12,2) := round(coalesce(p_deposit_amount, 0)::numeric, 2);
  v_actual_amount numeric(12,2) := round(coalesce(p_actual_amount, 0)::numeric, 2);
begin
  if p_reservation_id is null then
    raise exception 'reservation_id is required';
  end if;

  if v_folio_amount <= 0 then
    raise exception 'folio payment amount must be > 0';
  end if;

  if v_deposit_amount <= 0 then
    raise exception 'deposit amount must be > 0';
  end if;

  if v_actual_amount <= 0 then
    raise exception 'transfer actual amount must be > 0';
  end if;

  if v_actual_amount <> round((v_folio_amount + v_deposit_amount)::numeric, 2) then
    raise exception 'actual transfer amount must equal folio payment plus deposit';
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
    v_actual_amount,
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
    'payment'::public.payment_tx_type,
    'transfer'::public.payment_method_type,
    v_folio_amount,
    nullif(btrim(p_folio_note), ''),
    'room_revenue',
    coalesce(nullif(btrim(p_cashier_name), ''), 'FO'),
    false,
    p_paid_date,
    p_paid_at,
    p_recorded_by,
    v_transfer_event_id
  )
  returning id into v_payment_id;

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
    'deposit'::public.payment_tx_type,
    'transfer'::public.payment_method_type,
    v_deposit_amount,
    nullif(btrim(p_folio_note), ''),
    'deposit',
    coalesce(nullif(btrim(p_cashier_name), ''), 'FO'),
    false,
    p_paid_date,
    p_paid_at,
    p_recorded_by,
    v_transfer_event_id
  )
  returning id into v_deposit_payment_id;

  return query select v_payment_id, v_deposit_payment_id, v_transfer_event_id;
end;
$$;

grant execute on function public.create_manual_transfer_payment_with_deposit_split(
  uuid,
  numeric,
  numeric,
  text,
  text,
  date,
  timestamptz,
  uuid,
  numeric,
  text,
  text,
  timestamptz,
  text
) to authenticated, service_role;

comment on function public.create_manual_transfer_payment_with_deposit_split(
  uuid,
  numeric,
  numeric,
  text,
  text,
  date,
  timestamptz,
  uuid,
  numeric,
  text,
  text,
  timestamptz,
  text
) is
  'Creates one manual transfer event and links exact-match room payment + deposit folio rows atomically.';
