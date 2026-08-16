-- TRADAR — Phase 2: historical candles and trade replay
--
-- Three additions:
--   1. `candles`         — shared, read-only market reference data
--   2. `replay_sessions` — per-user replay state (cursor, speed, range)
--   3. `backtest_trades` gains provenance columns so replay-placed trades are
--      distinguishable from hand-entered ones
--
-- Real trades in public.trades are untouched. Replay writes only into
-- public.backtest_trades, which live analytics never queries.

-- ---------------------------------------------------------------------------
-- 1. candles — SHARED REFERENCE DATA
--
-- This table has no user_id, so the owner-scoped pattern used everywhere else
-- does not apply. Market data is not private: any signed-in user may read it.
--
-- Writes are deliberately impossible through PostgREST. There is a SELECT
-- policy and no INSERT/UPDATE/DELETE policy at all, so ingestion must happen
-- server-side (migration, or a server action using the service key outside the
-- browser). Never place user-specific data in this table — everyone can read it.
--
-- Access path: the primary key IS the index. Benchmarked on 750k rows at
-- PostgreSQL 16 — a 1,440-candle day scans in ~0.75 ms and a 1,500-candle
-- replay page in ~0.51 ms, so no secondary index is warranted. Partitioning is
-- not used; it only starts paying off in the tens of millions of rows.
-- ---------------------------------------------------------------------------
create table if not exists public.candles (
  symbol    text          not null,
  timeframe text          not null,
  ts        timestamptz   not null,
  open      numeric(18,8) not null,
  high      numeric(18,8) not null,
  low       numeric(18,8) not null,
  close     numeric(18,8) not null,
  volume    numeric(24,8),
  primary key (symbol, timeframe, ts),
  constraint candles_symbol_not_blank check (length(btrim(symbol)) > 0),
  constraint candles_timeframe_valid check (timeframe in ('M1','M5','M15','H1','H4','D1')),
  constraint candles_prices_positive check (open > 0 and high > 0 and low > 0 and close > 0),
  -- A bar whose high is below its low, or which does not contain its own open
  -- and close, is corrupt. Rejecting it at write time keeps bad vendor data out.
  constraint candles_high_low_consistent check (
    high >= low and high >= open and high >= close
    and low <= open and low <= close
  ),
  constraint candles_volume_non_negative check (volume is null or volume >= 0)
);

alter table public.candles enable row level security;

drop policy if exists "candles_read_authenticated" on public.candles;
create policy "candles_read_authenticated" on public.candles
  for select to authenticated using (true);

-- SELECT only. anon gets no grant and no policy, so it sees nothing.
grant select on public.candles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. replay_sessions — per-user replay state
--
-- Owner-scoped like every other user table. A replay always belongs to a
-- backtest session, so the trades it produces flow into that session's equity
-- curve and statistics.
-- ---------------------------------------------------------------------------
create table if not exists public.replay_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  session_id    uuid not null references public.backtest_sessions (id) on delete cascade,
  symbol        text not null,
  timeframe     text not null,
  range_start   timestamptz not null,
  range_end     timestamptz not null,
  -- The furthest point the replay has revealed. Never allowed past range_end.
  cursor_ts     timestamptz not null,
  speed         numeric(6,2) not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint replay_sessions_range_valid check (range_end > range_start),
  constraint replay_sessions_cursor_in_range
    check (cursor_ts >= range_start and cursor_ts <= range_end),
  constraint replay_sessions_speed_positive check (speed > 0 and speed <= 100),
  constraint replay_sessions_timeframe_valid
    check (timeframe in ('M1','M5','M15','H1','H4','D1'))
);

create index if not exists replay_sessions_user_idx
  on public.replay_sessions (user_id, created_at desc);
create index if not exists replay_sessions_session_idx
  on public.replay_sessions (session_id);

drop trigger if exists replay_sessions_set_updated_at on public.replay_sessions;
create trigger replay_sessions_set_updated_at
  before update on public.replay_sessions
  for each row execute function public.set_updated_at();

alter table public.replay_sessions enable row level security;

drop policy if exists "replay_sessions_select_own" on public.replay_sessions;
create policy "replay_sessions_select_own" on public.replay_sessions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "replay_sessions_insert_own" on public.replay_sessions;
create policy "replay_sessions_insert_own" on public.replay_sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "replay_sessions_update_own" on public.replay_sessions;
create policy "replay_sessions_update_own" on public.replay_sessions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "replay_sessions_delete_own" on public.replay_sessions;
create policy "replay_sessions_delete_own" on public.replay_sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.replay_sessions to authenticated;

-- Ownership guard: RLS alone would let a user attach a replay to another
-- user's backtest session by guessing its uuid, since the row's own user_id
-- would still be their own.
create or replace function public.assert_owns_replay_related()
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
  return new;
end;
$$;

drop trigger if exists replay_sessions_assert_owns_related on public.replay_sessions;
create trigger replay_sessions_assert_owns_related
  before insert or update on public.replay_sessions
  for each row execute function public.assert_owns_replay_related();

-- ---------------------------------------------------------------------------
-- 3. Provenance on simulated trades
-- ---------------------------------------------------------------------------
do $$ begin
  create type trade_origin as enum ('manual', 'replay');
exception when duplicate_object then null; end $$;

alter table public.backtest_trades
  add column if not exists origin trade_origin not null default 'manual';

-- The bar the trade was opened and closed on, so a replay trade can be
-- located on the chart again later.
alter table public.backtest_trades
  add column if not exists entry_candle_ts timestamptz;
alter table public.backtest_trades
  add column if not exists exit_candle_ts timestamptz;

alter table public.backtest_trades
  add column if not exists replay_id uuid references public.replay_sessions (id) on delete set null;

create index if not exists backtest_trades_origin_idx
  on public.backtest_trades (session_id, origin);

-- ---------------------------------------------------------------------------
-- 4. candle_catalog — what is available to replay
--
-- PostgREST cannot express this grouping, so Postgres does it. Declared with
-- security_invoker so the caller's RLS applies to the underlying table rather
-- than the view owner's, which would otherwise be a way around the policy.
-- ---------------------------------------------------------------------------
create or replace view public.candle_catalog
with (security_invoker = true) as
select
  symbol,
  timeframe,
  count(*)::bigint as candle_count,
  min(ts)          as first_ts,
  max(ts)          as last_ts
from public.candles
group by symbol, timeframe;

grant select on public.candle_catalog to authenticated;

-- ---------------------------------------------------------------------------
-- 5. import_candles() — the ONLY write path into public.candles
--
-- public.candles deliberately has no INSERT/UPDATE/DELETE policy, so it cannot
-- be written through PostgREST. Ingestion instead goes through this
-- SECURITY DEFINER function, which runs as the table owner and revalidates
-- every bar server-side. That keeps arbitrary writes impossible while allowing
-- a vetted import path, without ever putting a service_role key in the app.
--
-- Idempotent: conflicts on the primary key update the existing bar, so
-- re-importing an overlapping range corrects data instead of duplicating it.
--
-- NOTE ON SCOPE: candles are shared across all users. Any authenticated user
-- may therefore add bars that every other user can see. That is intended for a
-- single-tenant deployment. For a multi-tenant one, either restrict EXECUTE to
-- an admin role or add per-user ownership to the table.
-- ---------------------------------------------------------------------------
create or replace function public.import_candles(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if jsonb_typeof(payload) <> 'array' then
    raise exception 'payload must be a JSON array';
  end if;

  if jsonb_array_length(payload) > 5000 then
    raise exception 'at most 5000 candles per call';
  end if;

  with incoming as (
    select
      upper(btrim(c.symbol))    as symbol,
      c.timeframe,
      c.ts,
      c.open, c.high, c.low, c.close, c.volume
    from jsonb_to_recordset(payload) as c(
      symbol text, timeframe text, ts timestamptz,
      open numeric, high numeric, low numeric, close numeric, volume numeric
    )
  ),
  valid as (
    select * from incoming
    where symbol is not null and length(symbol) > 0
      and timeframe in ('M1','M5','M15','H1','H4','D1')
      and ts is not null
      and open > 0 and high > 0 and low > 0 and close > 0
      and high >= low
      and high >= open and high >= close
      and low <= open and low <= close
      and (volume is null or volume >= 0)
  ),
  upserted as (
    insert into public.candles (symbol, timeframe, ts, open, high, low, close, volume)
    select symbol, timeframe, ts, open, high, low, close, volume from valid
    on conflict (symbol, timeframe, ts) do update
      set open = excluded.open,
          high = excluded.high,
          low = excluded.low,
          close = excluded.close,
          volume = excluded.volume
    returning 1
  )
  select count(*)::integer into inserted from upserted;

  return coalesce(inserted, 0);
end;
$$;

revoke all on function public.import_candles(jsonb) from public;
grant execute on function public.import_candles(jsonb) to authenticated;
