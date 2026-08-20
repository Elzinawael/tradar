-- TRADAR — pending replay orders + explicit exit reason
--
-- TWO additions. Both were checked against the existing schema first.
--
-- 1. replay_orders (new table)
--
--    backtest_trades cannot hold a pending order without distorting it: its
--    `status` enum is (win, loss, breakeven, open) and every row is a trade
--    that exists, whereas a pending order is an intent that may never become
--    one. Overloading it would mean a "trade" with no entry price appearing in
--    analytics, and would break the partial unique index from 0008, which
--    assumes at most one OPEN row per replay while a replay may legitimately
--    have several resting orders. A separate, small table keeps the trade
--    table meaning exactly what it meant before.
--
-- 2. backtest_trades.exit_reason
--
--    Phase 3B inferred the exit by comparing exit_price against stop_price or
--    take_profit. That is wrong for gap fills, which exit at the bar's open and
--    so match neither level — a gapped stop was mislabelled "Position closed".
--    Recording the reason the engine actually acted on removes the guess.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type replay_order_type as enum ('market', 'limit', 'stop');
exception when duplicate_object then null; end $$;

do $$ begin
  create type replay_order_status as enum ('pending', 'filled', 'cancelled', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trade_exit_reason as enum ('stop_loss', 'take_profit', 'manual', 'other');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. exit_reason — backward compatible
--
-- Nullable with no default, so every pre-existing closed trade keeps a NULL and
-- nothing is retroactively relabelled with a reason the engine never recorded.
-- The UI falls back to its previous behaviour for those rows.
-- ---------------------------------------------------------------------------
alter table public.backtest_trades
  add column if not exists exit_reason trade_exit_reason;

-- An exit reason only makes sense on a closed trade.
do $$ begin
  alter table public.backtest_trades
    add constraint backtest_trades_exit_reason_requires_close
    check (exit_reason is null or status <> 'open');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. replay_orders
-- ---------------------------------------------------------------------------
create table if not exists public.replay_orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  replay_id       uuid not null references public.replay_sessions (id) on delete cascade,
  session_id      uuid not null references public.backtest_sessions (id) on delete cascade,
  strategy_id     uuid references public.strategies (id) on delete set null,

  symbol          text not null,
  timeframe       text not null,
  direction       trade_direction not null,
  order_type      replay_order_type not null,
  status          replay_order_status not null default 'pending',

  -- Null for a market order, which fills at the cursor candle's close.
  requested_price numeric(18,8),
  stop_price      numeric(18,8),
  take_profit     numeric(18,8),
  quantity        numeric(18,8) not null,

  -- Expiry is counted in REVEALED BARS, not wall-clock time: replay time is
  -- the cursor, and browser time is meaningless inside a simulation.
  expiry_bars     integer,
  bars_elapsed    integer not null default 0,

  -- Phase 3A classification, carried onto the trade when the order fills so
  -- metadata is not lost in the conversion.
  setup           text,
  market_session  text,
  tags            text[] not null default '{}',
  notes           text not null default '',

  -- Set when the order becomes a trade.
  filled_at       timestamptz,
  fill_price      numeric(18,8),
  trade_id        uuid references public.backtest_trades (id) on delete set null,
  cancelled_at    timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint replay_orders_symbol_not_blank check (length(btrim(symbol)) > 0),
  constraint replay_orders_quantity_positive check (quantity > 0),
  constraint replay_orders_prices_positive check (
    (requested_price is null or requested_price > 0)
    and (stop_price is null or stop_price > 0)
    and (take_profit is null or take_profit > 0)
    and (fill_price is null or fill_price > 0)
  ),
  constraint replay_orders_expiry_positive check (expiry_bars is null or expiry_bars > 0),
  constraint replay_orders_bars_elapsed_non_negative check (bars_elapsed >= 0),
  -- A limit or stop order must say at what price; a market order must not,
  -- because its price is decided by the server at fill time.
  constraint replay_orders_price_required check (
    (order_type = 'market' and requested_price is null)
    or (order_type <> 'market' and requested_price is not null)
  ),
  -- A filled order must record how and when it filled.
  constraint replay_orders_fill_consistency check (
    (status = 'filled' and filled_at is not null and fill_price is not null)
    or (status <> 'filled' and filled_at is null and fill_price is null)
  ),
  constraint replay_orders_cancel_consistency check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status <> 'cancelled' and cancelled_at is null)
  ),
  constraint replay_orders_setup_length check (setup is null or length(setup) <= 40),
  constraint replay_orders_market_session_length
    check (market_session is null or length(market_session) <= 40)
);

create index if not exists replay_orders_replay_status_idx
  on public.replay_orders (replay_id, status, created_at);
create index if not exists replay_orders_user_idx
  on public.replay_orders (user_id);

drop trigger if exists replay_orders_set_updated_at on public.replay_orders;
create trigger replay_orders_set_updated_at
  before update on public.replay_orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — owner-scoped, matching every other user table
-- ---------------------------------------------------------------------------
alter table public.replay_orders enable row level security;

drop policy if exists "replay_orders_select_own" on public.replay_orders;
create policy "replay_orders_select_own" on public.replay_orders
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "replay_orders_insert_own" on public.replay_orders;
create policy "replay_orders_insert_own" on public.replay_orders
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "replay_orders_update_own" on public.replay_orders;
create policy "replay_orders_update_own" on public.replay_orders
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "replay_orders_delete_own" on public.replay_orders;
create policy "replay_orders_delete_own" on public.replay_orders
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.replay_orders to authenticated;

-- ---------------------------------------------------------------------------
-- Ownership guard
--
-- RLS alone would let a user rest an order against another user's replay or
-- session by guessing a uuid, since the row's own user_id would still be
-- theirs. Same pattern as assert_owns_backtest_related().
-- ---------------------------------------------------------------------------
create or replace function public.assert_owns_replay_order_related()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  select user_id into owner from public.replay_sessions where id = new.replay_id;
  if owner is null or owner <> new.user_id then
    raise exception 'replay_id does not belong to the current user';
  end if;

  select user_id into owner from public.backtest_sessions where id = new.session_id;
  if owner is null or owner <> new.user_id then
    raise exception 'session_id does not belong to the current user';
  end if;

  if new.strategy_id is not null then
    select user_id into owner from public.strategies where id = new.strategy_id;
    if owner is null or owner <> new.user_id then
      raise exception 'strategy_id does not belong to the current user';
    end if;
  end if;

  if new.trade_id is not null then
    select user_id into owner from public.backtest_trades where id = new.trade_id;
    if owner is null or owner <> new.user_id then
      raise exception 'trade_id does not belong to the current user';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists replay_orders_assert_owns_related on public.replay_orders;
create trigger replay_orders_assert_owns_related
  before insert or update on public.replay_orders
  for each row execute function public.assert_owns_replay_order_related();

-- ---------------------------------------------------------------------------
-- At most one PENDING order per replay
--
-- Mirrors the one-open-position rule from 0008. A resting order is sized
-- against session equity exactly as a position is, so allowing several would
-- let a user stack risk that the sizing calculation never accounted for. This
-- is a database-level invariant rather than a check-then-insert, which would
-- race under a double submit.
-- ---------------------------------------------------------------------------
create unique index if not exists replay_orders_one_pending_per_replay
  on public.replay_orders (replay_id)
  where status = 'pending';
