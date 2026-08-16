-- TRADAR — backtesting: session notes + simulated trades
--
-- Design note: simulated trades live in their own table rather than in
-- `public.trades` with a nullable `backtest_session_id`.
--
-- Putting them in `trades` would mean every existing read — getTrades,
-- getTradesPage, getTradedSymbols, getDayDetail, the strategy statistics and
-- the CSV export — would need an `is null` filter added, and missing a single
-- one would silently fold hypothetical trades into real P&L. A separate table
-- makes that class of mistake impossible: live analytics cannot see backtest
-- rows because they are not in the table it queries.
--
-- The columns mirror `public.trades` so rows map onto the existing `Trade`
-- type, which lets the backtesting UI reuse TradeTable, lib/trade-math.ts and
-- the analytics engine unchanged. `account_id` is deliberately absent — a
-- simulated trade belongs to a session, not to a funded account — and
-- `stop_price` / `take_profit` are stored here because a backtest is where
-- planned levels matter.

-- ---------------------------------------------------------------------------
-- Session notes
-- ---------------------------------------------------------------------------
alter table public.backtest_sessions
  add column if not exists notes text not null default '';

-- ---------------------------------------------------------------------------
-- backtest_trades
-- ---------------------------------------------------------------------------
create table if not exists public.backtest_trades (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  session_id       uuid not null references public.backtest_sessions (id) on delete cascade,
  strategy_id      uuid references public.strategies (id) on delete set null,
  symbol           text not null,
  direction        trade_direction not null,
  entry_price      numeric(18,8) not null,
  exit_price       numeric(18,8),
  stop_price       numeric(18,8),
  take_profit      numeric(18,8),
  quantity         numeric(18,8) not null,
  pnl              numeric(18,2) not null default 0,
  fees             numeric(18,2) not null default 0,
  r_multiple       numeric(10,4),
  status           trade_status not null default 'open',
  opened_at        timestamptz not null,
  closed_at        timestamptz,
  duration_minutes integer,
  tags             text[] not null default '{}',
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint backtest_trades_symbol_not_blank check (length(btrim(symbol)) > 0),
  constraint backtest_trades_quantity_positive check (quantity > 0),
  constraint backtest_trades_entry_price_positive check (entry_price > 0),
  constraint backtest_trades_exit_price_positive
    check (exit_price is null or exit_price > 0),
  constraint backtest_trades_stop_price_positive
    check (stop_price is null or stop_price > 0),
  constraint backtest_trades_take_profit_positive
    check (take_profit is null or take_profit > 0),
  constraint backtest_trades_closed_after_opened
    check (closed_at is null or closed_at >= opened_at),
  -- Same rule as public.trades: a trade is closed only when it has both an
  -- exit price and an exit time.
  constraint backtest_trades_closed_consistency check (
    (status = 'open' and closed_at is null)
    or (status <> 'open' and closed_at is not null and exit_price is not null)
  )
);

create index if not exists backtest_trades_session_idx
  on public.backtest_trades (session_id, opened_at desc);
create index if not exists backtest_trades_user_idx
  on public.backtest_trades (user_id);
create index if not exists backtest_trades_strategy_idx
  on public.backtest_trades (strategy_id);

drop trigger if exists backtest_trades_set_updated_at on public.backtest_trades;
create trigger backtest_trades_set_updated_at
  before update on public.backtest_trades
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.backtest_trades enable row level security;

drop policy if exists "backtest_trades_select_own" on public.backtest_trades;
create policy "backtest_trades_select_own" on public.backtest_trades
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "backtest_trades_insert_own" on public.backtest_trades;
create policy "backtest_trades_insert_own" on public.backtest_trades
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "backtest_trades_update_own" on public.backtest_trades;
create policy "backtest_trades_update_own" on public.backtest_trades
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "backtest_trades_delete_own" on public.backtest_trades;
create policy "backtest_trades_delete_own" on public.backtest_trades
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Cross-table ownership guard
--
-- RLS alone would let a user insert a simulated trade into ANOTHER user's
-- session by guessing its uuid, because the row's own user_id would still be
-- their own. This verifies the referenced session and strategy belong to the
-- caller, mirroring public.assert_owns_related() for the live tables.
-- ---------------------------------------------------------------------------
create or replace function public.assert_owns_backtest_related()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
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

  return new;
end;
$$;

drop trigger if exists backtest_trades_assert_owns_related on public.backtest_trades;
create trigger backtest_trades_assert_owns_related
  before insert or update on public.backtest_trades
  for each row execute function public.assert_owns_backtest_related();

-- ---------------------------------------------------------------------------
-- Grants (RLS decides which rows; grants decide table access at all)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.backtest_trades to authenticated;
grant select on public.backtest_trades to anon;
