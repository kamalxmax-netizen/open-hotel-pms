begin;

create or replace function public.sync_reservation_deposit_snapshot_from_folio(
  p_reservation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(10,2);
  v_snapshot_note text;
  v_last_paid_at timestamptz;
begin
  if p_reservation_id is null then
    return;
  end if;

  with method_totals as (
    select
      public.normalize_deposit_method_text(coalesce(fp.method::text, 'cash')) as method,
      round(
        sum(
          case
            when fp.tx_type = 'deposit' then fp.amount
            when fp.tx_type = 'payment' then fp.amount
            when fp.tx_type = 'refund' then -fp.amount
            else 0
          end
        )::numeric,
        2
      ) as amount
    from public.folio_payments fp
    where fp.reservation_id = p_reservation_id
      and coalesce(fp.revenue_category, '') = 'deposit'
      and coalesce(fp.is_record_only, false) = false
    group by public.normalize_deposit_method_text(coalesce(fp.method::text, 'cash'))
  ),
  active_lines as (
    select method, amount
    from method_totals
    where amount > 0
  )
  select coalesce(round(sum(amount)::numeric, 2), 0)
  into v_total
  from active_lines;

  select max(fp.paid_at)
  into v_last_paid_at
  from public.folio_payments fp
  where fp.reservation_id = p_reservation_id
    and coalesce(fp.revenue_category, '') = 'deposit'
    and fp.tx_type in ('deposit', 'payment')
    and coalesce(fp.is_record_only, false) = false;

  with method_totals as (
    select
      public.normalize_deposit_method_text(coalesce(fp.method::text, 'cash')) as method,
      round(
        sum(
          case
            when fp.tx_type = 'deposit' then fp.amount
            when fp.tx_type = 'payment' then fp.amount
            when fp.tx_type = 'refund' then -fp.amount
            else 0
          end
        )::numeric,
        2
      ) as amount
    from public.folio_payments fp
    where fp.reservation_id = p_reservation_id
      and coalesce(fp.revenue_category, '') = 'deposit'
      and coalesce(fp.is_record_only, false) = false
    group by public.normalize_deposit_method_text(coalesce(fp.method::text, 'cash'))
  ),
  active_lines as (
    select method, amount
    from method_totals
    where amount > 0
  )
  select
    case
      when coalesce(v_total, 0) <= 0 then null
      else jsonb_build_object(
        'lines',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'method', method,
                'amount', amount
              )
              order by method
            )
            from active_lines
          ),
          '[]'::jsonb
        )
      )::text
    end
  into v_snapshot_note;

  update public.reservations
  set deposit_amount = coalesce(v_total, 0),
      deposit_paid_at = case when coalesce(v_total, 0) > 0 then v_last_paid_at else null end,
      deposit_note = v_snapshot_note,
      updated_at = timezone('utc', now())
  where id = p_reservation_id;
end;
$$;

commit;
