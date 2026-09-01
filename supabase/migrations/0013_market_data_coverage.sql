-- TRADAR — historical market-data coverage + a secure engine ingestion path
--
-- Fixes two defects from the architecture audit:
--
-- 1. INGESTION. public.import_candles() is admin-only (0006). The market-data
--    engine (lib/market-data/service.ts) fetches from a provider with
--    server-side keys, normalises, then must persist — but on a deployment
--    where the operator is not in admin_users, every fetch stored nothing and
--    Replay reported "no data available". This adds a SEPARATE, narrower write
--    path for engine-fetched data. import_candles() stays admin-only for bulk
--    CSV / manual import.
--
-- 2. COVERAGE. candle_catalog exposes only min(ts)/max(ts). A dataset with an
--    interior hole (Jan 1-5 and Jan 20-31 stored, Jan 6-19 missing) looked
--    "fully covered". public.candle_coverage records the ranges that have
--    actually been requested from a source, as explicit spans, so the engine
--    re-fetches only true gaps and Replay can verify a window before it starts.
--
-- No existing table, policy, function or grant is weakened. import_candles(),
-- is_admin(), admin_users and every RLS policy are untouched.

-- ---------------------------------------------------------------------------
-- 1. candle_coverage — explicit fetched-range spans
--
-- The window that was REQUESTED from a source, not the bar span: a weekend or
-- holiday inside a requested range legitimately has no bars, and "covered"
-- must mean "we asked and the source answered", or those periods would be
-- re-fetched forever. Spans may overlap; the application merges them
-- (lib/market-data/coverage.ts). Append-only, which doubles as an audit trail.
-- ---------------------------------------------------------------------------
create table if not exists public.candle_coverage (
  id            uuid primary key default gen_random_uuid(),
  symbol        text not null,
  timeframe     text not null,
  range_start   timestamptz not null,
  range_end     timestamptz not null,
  -- Diagnostics only.
  bar_count     integer not null default 0,
  first_bar_ts  timestamptz,
  last_bar_ts   timestamptz,
  source        text not null default 'provider',
  created_at    timestamptz not null default now(),
  constraint candle_coverage_range check (range_end > range_start),
  constraint candle_coverage_tf
    check (timeframe in ('M1','M5','M15','H1','H4','D1')),
  constraint candle_coverage_symbol_not_blank check (length(btrim(symbol)) > 0)
);

create index if not exists candle_coverage_lookup
  on public.candle_coverage (symbol, timeframe, range_start, range_end);

alter table public.candle_coverage enable row level security;

-- Shared reference data, exactly like public.candles: any authenticated user
-- may read it.
drop policy if exists "candle_coverage_read" on public.candle_coverage;
create policy "candle_coverage_read" on public.candle_coverage
  for select to authenticated using (true);

-- No write policy and no write grant: the SECURITY DEFINER functions below
-- are the only way in, the same pattern public.candles uses.
grant select on public.candle_coverage to authenticated;

-- ---------------------------------------------------------------------------
-- 2. market_data_ingest_log — audit + rate-limit source of truth
-- ---------------------------------------------------------------------------
create table if not exists public.market_data_ingest_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  symbol        text not null,
  timeframe     text not null,
  bars_ingested integer not null default 0,
  bars_skipped  integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists market_data_ingest_log_rate
  on public.market_data_ingest_log (user_id, created_at desc);

alter table public.market_data_ingest_log enable row level security;

drop policy if exists "market_data_ingest_log_read_own" on public.market_data_ingest_log;
create policy "market_data_ingest_log_read_own" on public.market_data_ingest_log
  for select to authenticated using ((select auth.uid()) = user_id);

grant select on public.market_data_ingest_log to authenticated;

-- ---------------------------------------------------------------------------
-- 3. ingest_market_data() — the engine's write path
--
-- NOT a general "insert candles" endpoint:
--
--   * authentication is required
--   * the symbol MUST exist in public.instruments and be active — a client
--     cannot make the engine store bars for an invented ticker
--   * per-user rolling-24h bar limit (generous for real use, bounds abuse)
--   * every bar revalidated in SQL, identical checks to import_candles()
--   * every call written to market_data_ingest_log
--   * the requested span is written to candle_coverage
--
-- THREAT MODEL. On the current single-tenant deployment the only caller is the
-- operator, and candles are already shared / operator-controlled, so this
-- grants nothing new in practice. On a future multi-tenant deployment an
-- authenticated user could inject plausible bars for a REGISTERED symbol into
-- the shared table; the rate limit bounds the damage and the log makes it
-- detectable. Per-tenant candle namespacing is the follow-up if TRADAR becomes
-- multi-tenant. This is deliberately a smaller surface than making
-- import_candles() itself non-admin.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_market_data(
  p_symbol      text,
  p_timeframe   text,
  p_candles     jsonb,
  p_range_start timestamptz default null,
  p_range_end   timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_symbol   text := upper(btrim(p_symbol));
  v_recent   bigint;
  v_limit    constant integer := 500000;   -- bars / user / rolling 24h
  v_incoming integer;
  v_ingested integer := 0;
  v_skipped  integer := 0;
  v_first    timestamptz;
  v_last     timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_timeframe not in ('M1','M5','M15','H1','H4','D1') then
    raise exception 'invalid timeframe %', p_timeframe using errcode = '22023';
  end if;

  if jsonb_typeof(p_candles) <> 'array' then
    raise exception 'p_candles must be a JSON array' using errcode = '22023';
  end if;

  v_incoming := jsonb_array_length(p_candles);

  if not exists (select 1 from public.instruments where symbol = v_symbol and active) then
    raise exception 'unknown or inactive instrument %', v_symbol using errcode = '23503';
  end if;

  -- The coverage span is what was REQUESTED (weekends inside it count as
  -- covered). Recorded even for an empty response so a genuinely empty range
  -- is not re-fetched forever. The caller (the engine) always supplies it.
  if p_range_start is not null and p_range_end is not null
     and p_range_end > p_range_start then
    insert into public.candle_coverage
      (symbol, timeframe, range_start, range_end, bar_count, source)
    values (v_symbol, p_timeframe, p_range_start, p_range_end, greatest(v_incoming, 0), 'provider');
  end if;

  if v_incoming = 0 then
    return jsonb_build_object('ingested', 0, 'skipped', 0);
  end if;
  if v_incoming > 50000 then
    raise exception 'at most 50000 candles per call' using errcode = '22023';
  end if;

  select coalesce(sum(bars_ingested), 0) into v_recent
  from public.market_data_ingest_log
  where user_id = v_uid and created_at > now() - interval '24 hours';

  if v_recent + v_incoming > v_limit then
    raise exception
      'market data ingestion limit reached (% bars / 24h). Narrow the range or use a higher timeframe.',
      v_limit using errcode = '53400';
  end if;

  with incoming as (
    select v_symbol as symbol, p_timeframe as timeframe,
           c.ts, c.open, c.high, c.low, c.close, c.volume
    from jsonb_to_recordset(p_candles) as c(
      ts timestamptz, open numeric, high numeric, low numeric, close numeric, volume numeric
    )
  ),
  valid as (
    select * from incoming
    where ts is not null
      and open > 0 and high > 0 and low > 0 and close > 0
      and high >= low and high >= open and high >= close
      and low <= open and low <= close
      and (volume is null or volume >= 0)
  ),
  upserted as (
    insert into public.candles (symbol, timeframe, ts, open, high, low, close, volume)
    select symbol, timeframe, ts, open, high, low, close, volume from valid
    on conflict (symbol, timeframe, ts) do update
      set open = excluded.open, high = excluded.high, low = excluded.low,
          close = excluded.close, volume = excluded.volume
    returning ts
  )
  select count(*)::int, min(ts), max(ts) into v_ingested, v_first, v_last from upserted;

  v_skipped := v_incoming - v_ingested;

  insert into public.market_data_ingest_log
    (user_id, symbol, timeframe, bars_ingested, bars_skipped)
  values (v_uid, v_symbol, p_timeframe, v_ingested, v_skipped);

  return jsonb_build_object(
    'ingested', v_ingested, 'skipped', v_skipped,
    'first', v_first, 'last', v_last
  );
end;
$$;

revoke all on function
  public.ingest_market_data(text, text, jsonb, timestamptz, timestamptz) from public;
grant execute on function
  public.ingest_market_data(text, text, jsonb, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. record_candle_coverage() — coverage trail for the admin import path
--
-- import_candles() (0006) stays admin-only and unchanged. This companion lets
-- the CSV / Binance importer record what it loaded, so the engine does not
-- later re-fetch a range an administrator already imported.
-- ---------------------------------------------------------------------------
create or replace function public.record_candle_coverage(
  p_symbol      text,
  p_timeframe   text,
  p_range_start timestamptz,
  p_range_end   timestamptz,
  p_bar_count   integer,
  p_source      text default 'import'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    return;
  end if;
  if p_timeframe not in ('M1','M5','M15','H1','H4','D1') then
    return;
  end if;
  insert into public.candle_coverage
    (symbol, timeframe, range_start, range_end, bar_count, source)
  values (upper(btrim(p_symbol)), p_timeframe, p_range_start, p_range_end,
          coalesce(p_bar_count, 0), p_source);
end;
$$;

revoke all on function
  public.record_candle_coverage(text, text, timestamptz, timestamptz, integer, text) from public;
grant execute on function
  public.record_candle_coverage(text, text, timestamptz, timestamptz, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. replay dataset snapshot
--
-- What the coverage looked like when the replay was created, so the replay
-- page can tell the user if the underlying candles changed since (a
-- re-import). Per-session candle immutability is a later enhancement.
-- ---------------------------------------------------------------------------
alter table public.replay_sessions
  add column if not exists dataset_bars integer;
alter table public.replay_sessions
  add column if not exists dataset_first_ts timestamptz;
alter table public.replay_sessions
  add column if not exists dataset_last_ts timestamptz;
