-- TRADAR — Phase 2 database tests: candles and trade replay
--
-- Run after 00_local_harness.sql and migrations 0001-0005.
-- Assertions raise on failure, so ON_ERROR_STOP turns any FAIL into exit 1.

\set ON_ERROR_STOP on

create or replace function assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end $$;

\echo '--- R1. candles: shared reference data ---'

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ann@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ben@example.com');

-- Seed a deterministic M1 series: 120 minutes of EURUSD.
insert into public.candles (symbol, timeframe, ts, open, high, low, close, volume)
select 'EURUSD', 'M1',
       '2026-01-05T09:00:00Z'::timestamptz + (g || ' minutes')::interval,
       1.1000 + g * 0.0001,
       1.1000 + g * 0.0001 + 0.0005,
       1.1000 + g * 0.0001 - 0.0005,
       1.1000 + g * 0.0001 + 0.0002,
       100 + g
from generate_series(0, 119) g;

select assert(
  (select count(*) from public.candles) = 120,
  'candles seeded'
);

-- Corrupt bars must be rejected by the consistency constraint.
do $$
begin
  begin
    insert into public.candles (symbol, timeframe, ts, open, high, low, close)
    values ('BADBAR', 'M1', now(), 1.0, 0.5, 2.0, 1.0);  -- high < low
    raise exception 'FAIL  corrupt candle (high < low) accepted';
  exception when check_violation then
    raise notice 'PASS  candle with high below low rejected';
  end;

  begin
    insert into public.candles (symbol, timeframe, ts, open, high, low, close)
    values ('BADBAR', 'M1', now(), 5.0, 2.0, 1.0, 1.5);  -- high < open
    raise exception 'FAIL  candle not containing its open accepted';
  exception when check_violation then
    raise notice 'PASS  candle whose high excludes its open rejected';
  end;

  begin
    insert into public.candles (symbol, timeframe, ts, open, high, low, close)
    values ('BADTF', 'M7', now(), 1.0, 1.1, 0.9, 1.0);
    raise exception 'FAIL  unknown timeframe accepted';
  exception when check_violation then
    raise notice 'PASS  unknown timeframe rejected';
  end;

  -- The primary key makes ingestion idempotent: re-importing the same bar
  -- must not create a duplicate.
  begin
    insert into public.candles (symbol, timeframe, ts, open, high, low, close)
    values ('EURUSD', 'M1', '2026-01-05T09:00:00Z', 1.1, 1.2, 1.0, 1.15);
    raise exception 'FAIL  duplicate candle accepted';
  exception when unique_violation then
    raise notice 'PASS  duplicate (symbol, timeframe, ts) rejected';
  end;
end $$;

\echo '--- R2. candle RLS ---'

set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

select assert(
  (select count(*) from public.candles) = 120,
  'any signed-in user can read candles'
);

-- Writes must be impossible through PostgREST: there is no write policy.
do $$
begin
  begin
    insert into public.candles (symbol, timeframe, ts, open, high, low, close)
    values ('HACK', 'M1', now(), 1, 1, 1, 1);
    raise exception 'FAIL  authenticated user inserted a candle';
  exception when insufficient_privilege or others then
    raise notice 'PASS  authenticated user cannot insert candles';
  end;
end $$;

do $$
declare affected integer;
begin
  begin
    update public.candles set close = 9.99 where symbol = 'EURUSD';
    get diagnostics affected = row_count;
    if affected = 0 then
      raise notice 'PASS  authenticated user cannot update candles';
    else
      raise exception 'FAIL  authenticated user updated % candles', affected;
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS  authenticated user cannot update candles';
  end;
end $$;

reset role;
set role anon;
do $$
begin
  begin
    if (select count(*) from public.candles) > 0 then
      raise exception 'FAIL  anon read candles';
    end if;
    raise notice 'PASS  anon sees no candles';
  exception when insufficient_privilege then
    raise notice 'PASS  anon has no access to candles';
  end;
end $$;
reset role;

\echo '--- R3. candle range queries ---'

set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

select assert(
  (select count(*) from public.candles
    where symbol = 'EURUSD' and timeframe = 'M1'
      and ts >= '2026-01-05T09:00:00Z' and ts < '2026-01-05T10:00:00Z') = 60,
  'one-hour range returns exactly 60 M1 candles'
);

select assert(
  (select count(*) from public.candles
    where symbol = 'EURUSD' and timeframe = 'M1'
      and ts <= '2026-01-05T09:29:00Z') = 30,
  'cursor-bounded query returns only candles up to the cursor'
);

-- Look-ahead protection at the data layer: nothing past the cursor is returned.
select assert(
  (select count(*) from public.candles
    where symbol = 'EURUSD' and timeframe = 'M1'
      and ts <= '2026-01-05T09:29:00Z'
      and ts > '2026-01-05T09:29:00Z') = 0,
  'no candle after the cursor is ever included'
);

\echo '--- R4. candle aggregation (M1 -> H1) ---'

-- Aggregation used by the backfill tool: first open, max high, min low,
-- last close, summed volume, per bucket.
select assert(
  (select count(*) from (
     select date_trunc('hour', ts) from public.candles
      where symbol = 'EURUSD' and timeframe = 'M1' group by 1
   ) t) = 2,
  '120 M1 candles aggregate into 2 hourly buckets'
);

select assert(
  (select (array_agg(open order by ts))[1] from public.candles
    where symbol = 'EURUSD' and timeframe = 'M1'
      and ts >= '2026-01-05T09:00:00Z' and ts < '2026-01-05T10:00:00Z')
  = 1.10000000,
  'aggregated bucket open is the first candle open'
);

select assert(
  (select max(high) from public.candles
    where symbol = 'EURUSD' and timeframe = 'M1'
      and ts >= '2026-01-05T09:00:00Z' and ts < '2026-01-05T10:00:00Z')
  = (select max(high) from public.candles
      where symbol = 'EURUSD' and timeframe = 'M1'
        and ts >= '2026-01-05T09:00:00Z' and ts < '2026-01-05T10:00:00Z'),
  'aggregated bucket high is the max of its candles'
);

reset role;

\echo '--- R5. replay sessions and cross-user isolation ---'

insert into public.backtest_sessions (user_id, name, symbol, timeframe, initial_balance)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Ann backtest', 'EURUSD', 'M1', 10000),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Ben backtest', 'EURUSD', 'M1', 10000);

insert into public.replay_sessions
  (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts)
select 'aaaaaaaa-0000-0000-0000-000000000001', id, 'EURUSD', 'M1',
       '2026-01-05T09:00:00Z', '2026-01-05T11:00:00Z', '2026-01-05T09:00:00Z'
  from public.backtest_sessions where name = 'Ann backtest';

insert into public.replay_sessions
  (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts)
select 'bbbbbbbb-0000-0000-0000-000000000002', id, 'EURUSD', 'M1',
       '2026-01-05T09:00:00Z', '2026-01-05T11:00:00Z', '2026-01-05T09:00:00Z'
  from public.backtest_sessions where name = 'Ben backtest';

select assert(
  (select count(*) from public.replay_sessions) = 2,
  'replay sessions created for two users'
);

-- The cursor may not be placed outside the selected range.
do $$
declare s uuid;
begin
  select id into s from public.backtest_sessions where name = 'Ann backtest';
  begin
    insert into public.replay_sessions
      (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts)
    values ('aaaaaaaa-0000-0000-0000-000000000001', s, 'EURUSD', 'M1',
            '2026-01-05T09:00:00Z', '2026-01-05T11:00:00Z', '2026-01-05T23:00:00Z');
    raise exception 'FAIL  cursor beyond range_end accepted';
  exception when check_violation then
    raise notice 'PASS  cursor cannot be set beyond range_end';
  end;

  begin
    update public.replay_sessions
       set cursor_ts = '2026-01-06T00:00:00Z'
     where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FAIL  cursor advanced beyond range_end';
  exception when check_violation then
    raise notice 'PASS  cursor cannot advance beyond range_end';
  end;
end $$;

-- A user must not attach a replay to another user's backtest session.
do $$
declare ben_session uuid;
begin
  select id into ben_session from public.backtest_sessions where name = 'Ben backtest';
  begin
    insert into public.replay_sessions
      (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts)
    values ('aaaaaaaa-0000-0000-0000-000000000001', ben_session, 'EURUSD', 'M1',
            '2026-01-05T09:00:00Z', '2026-01-05T11:00:00Z', '2026-01-05T09:00:00Z');
    raise exception 'FAIL  cross-user replay attachment accepted';
  exception when others then
    if sqlerrm like '%session_id does not belong%' then
      raise notice 'PASS  cross-user replay attachment blocked';
    else
      raise;
    end if;
  end;
end $$;

set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

select assert(
  (select count(*) from public.replay_sessions) = 1,
  'Ann sees only her own replay session'
);

do $$
declare affected integer;
begin
  update public.replay_sessions set speed = 99
   where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice 'PASS  Ann cannot update Ben''s replay session';
  else
    raise exception 'FAIL  Ann updated Ben''s replay session';
  end if;

  delete from public.replay_sessions
   where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice 'PASS  Ann cannot delete Ben''s replay session';
  else
    raise exception 'FAIL  Ann deleted Ben''s replay session';
  end if;
end $$;

reset role;
set role anon;
select assert(
  (select count(*) from public.replay_sessions) = 0,
  'anon sees no replay sessions'
);
reset role;

\echo '--- R6. replay trades and session integration ---'

-- A replay-placed trade is marked origin = replay and linked to its replay.
insert into public.backtest_trades
  (user_id, session_id, replay_id, origin, symbol, direction,
   entry_price, exit_price, quantity, pnl, status,
   opened_at, closed_at, duration_minutes, entry_candle_ts, exit_candle_ts)
select 'aaaaaaaa-0000-0000-0000-000000000001', b.id, r.id, 'replay',
       'EURUSD', 'long', 1.1000, 1.1100, 10000, 100, 'win',
       '2026-01-05T09:10:00Z', '2026-01-05T09:40:00Z', 30,
       '2026-01-05T09:10:00Z', '2026-01-05T09:40:00Z'
  from public.backtest_sessions b
  join public.replay_sessions r on r.session_id = b.id
 where b.name = 'Ann backtest';

-- A manually entered trade in the same session stays origin = manual.
insert into public.backtest_trades
  (user_id, session_id, symbol, direction, entry_price, exit_price,
   quantity, pnl, status, opened_at, closed_at, duration_minutes)
select 'aaaaaaaa-0000-0000-0000-000000000001', id, 'EURUSD', 'short',
       1.1200, 1.1150, 10000, 50, 'win',
       '2026-01-05T10:00:00Z', '2026-01-05T10:30:00Z', 30
  from public.backtest_sessions where name = 'Ann backtest';

-- Scoped to Ann's session: earlier test sections leave their own rows behind.
select assert(
  (select count(*) from public.backtest_trades bt
     join public.backtest_sessions b on b.id = bt.session_id
    where b.name = 'Ann backtest' and bt.origin = 'replay') = 1,
  'replay trade is marked origin = replay'
);
select assert(
  (select count(*) from public.backtest_trades bt
     join public.backtest_sessions b on b.id = bt.session_id
    where b.name = 'Ann backtest' and bt.origin = 'manual') = 1,
  'manually entered trade defaults to origin = manual'
);

-- Both feed the same session, so statistics and the equity curve include both.
select assert(
  (select count(*) from public.backtest_trades bt
     join public.backtest_sessions b on b.id = bt.session_id
    where b.name = 'Ann backtest') = 2,
  'replay and manual trades share one session'
);
select assert(
  (select sum(pnl) from public.backtest_trades bt
     join public.backtest_sessions b on b.id = bt.session_id
    where b.name = 'Ann backtest') = 150,
  'session net P&L combines replay and manual trades'
);

-- REAL trades must remain completely separate.
select assert(
  (select count(*) from public.trades
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
  'replay trades never appear in the live trades table'
);

set role authenticated;
set request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002"}';
select assert(
  (select count(*) from public.backtest_trades) = 0,
  'Ben cannot see Ann''s replay trades'
);
reset role;

-- Deleting the replay keeps its trades but clears the link, so a session's
-- history survives discarding a replay.
delete from public.replay_sessions
 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select assert(
  (select count(*) from public.backtest_trades bt
     join public.backtest_sessions b on b.id = bt.session_id
    where b.name = 'Ann backtest' and bt.origin = 'replay') = 1,
  'deleting a replay preserves the trades it produced'
);
select assert(
  (select bt.replay_id from public.backtest_trades bt
     join public.backtest_sessions b on b.id = bt.session_id
    where b.name = 'Ann backtest' and bt.origin = 'replay') is null,
  'replay_id is nulled rather than cascading the delete'
);

\echo '--- REPLAY TESTS PASSED ---'

\echo '--- R7. candle_catalog view ---'

set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

select assert(
  (select candle_count from public.candle_catalog
    where symbol = 'EURUSD' and timeframe = 'M1') = 120,
  'catalog reports the candle count'
);
select assert(
  (select first_ts from public.candle_catalog
    where symbol = 'EURUSD' and timeframe = 'M1') = '2026-01-05T09:00:00Z'::timestamptz,
  'catalog reports the first available bar'
);

reset role;
set role anon;
-- security_invoker means the view respects the caller's RLS, so anon sees
-- nothing through it either.
do $$
begin
  begin
    if (select count(*) from public.candle_catalog) > 0 then
      raise exception 'FAIL  anon read the candle catalog';
    end if;
    raise notice 'PASS  anon sees nothing through the catalog view';
  exception when insufficient_privilege then
    raise notice 'PASS  anon has no access to the catalog view';
  end;
end $$;
reset role;

\echo '--- R8. import_candles() is the only write path ---'

set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

select assert(
  public.import_candles('[
    {"symbol":"btcusdt","timeframe":"H1","ts":"2026-02-01T00:00:00Z","open":50000,"high":50500,"low":49800,"close":50200,"volume":12.5}
  ]'::jsonb) = 1,
  'import_candles inserts a valid bar'
);

select assert(
  (select count(*) from public.candles where symbol = 'BTCUSDT') = 1,
  'symbol is normalised to upper case on import'
);

-- Idempotency: re-importing the same bar updates rather than duplicating.
select assert(
  public.import_candles('[
    {"symbol":"BTCUSDT","timeframe":"H1","ts":"2026-02-01T00:00:00Z","open":50000,"high":51000,"low":49800,"close":50900,"volume":20}
  ]'::jsonb) = 1,
  'reimporting the same bar succeeds'
);
select assert(
  (select count(*) from public.candles where symbol = 'BTCUSDT') = 1,
  'reimport updates in place rather than duplicating'
);
select assert(
  (select close from public.candles where symbol = 'BTCUSDT') = 50900,
  'reimport overwrites the bar with the newer values'
);

-- Malformed bars are dropped by the function, not written.
select assert(
  public.import_candles('[
    {"symbol":"BADBAR","timeframe":"H1","ts":"2026-02-01T00:00:00Z","open":100,"high":50,"low":150,"close":100},
    {"symbol":"BADTF","timeframe":"M7","ts":"2026-02-01T00:00:00Z","open":1,"high":2,"low":0.5,"close":1.5},
    {"symbol":"","timeframe":"H1","ts":"2026-02-01T00:00:00Z","open":1,"high":2,"low":0.5,"close":1.5}
  ]'::jsonb) = 0,
  'import_candles rejects corrupt bars, unknown timeframes and blank symbols'
);
select assert(
  (select count(*) from public.candles where symbol in ('BADBAR','BADTF')) = 0,
  'no corrupt bar reaches the table'
);

-- Direct table writes remain impossible even though the function is allowed.
do $$
begin
  begin
    insert into public.candles (symbol, timeframe, ts, open, high, low, close)
    values ('DIRECT', 'H1', now(), 1, 2, 0.5, 1.5);
    raise exception 'FAIL  direct candle insert succeeded';
  exception when insufficient_privilege or others then
    raise notice 'PASS  direct candle insert still blocked';
  end;
end $$;

reset role;

-- Unauthenticated callers cannot use the function at all.
set role anon;
do $$
begin
  begin
    perform public.import_candles('[]'::jsonb);
    raise exception 'FAIL  anon executed import_candles';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot execute import_candles';
  when others then
    if sqlerrm like '%authentication required%' then
      raise notice 'PASS  import_candles requires authentication';
    else
      raise;
    end if;
  end;
end $$;
reset role;
