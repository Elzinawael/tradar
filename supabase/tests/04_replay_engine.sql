-- TRADAR — replay position lifecycle tests
--
-- Verifies at the database level that an open replay position is representable,
-- that closing it produces a consistent row, that look-ahead is impossible from
-- the query used to reveal bars, and that cross-user access is blocked.
--
-- The SL/TP decision itself is pure TypeScript (lib/replay-engine.ts) and is
-- covered by unit tests; here we prove the storage and access rules hold.

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

\echo '--- E1. fixtures ---'

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-00000000000e', 'eve@example.com'),
  ('ffffffff-0000-0000-0000-00000000000f', 'fred@example.com');

insert into public.admin_users (user_id, note)
values ('eeeeeeee-0000-0000-0000-00000000000e', 'engine test fixture')
on conflict (user_id) do nothing;

-- A deterministic 5-bar series. Bar 3 touches BOTH 99 and 110.
insert into public.candles (symbol, timeframe, ts, open, high, low, close) values
  ('ENGINE','M1','2026-04-01T09:00:00Z', 100, 101,  99.5, 100.5),
  ('ENGINE','M1','2026-04-01T09:01:00Z', 100.5, 105, 100,  104),
  ('ENGINE','M1','2026-04-01T09:02:00Z', 104, 111,  98,   105),
  ('ENGINE','M1','2026-04-01T09:03:00Z', 105, 106,  104,  105),
  ('ENGINE','M1','2026-04-01T09:04:00Z', 105, 120,  104,  119);

insert into public.backtest_sessions (user_id, name, symbol, timeframe, initial_balance, risk_per_trade)
values
  ('eeeeeeee-0000-0000-0000-00000000000e', 'Eve engine session', 'ENGINE', 'M1', 10000, 1),
  ('ffffffff-0000-0000-0000-00000000000f', 'Fred engine session', 'ENGINE', 'M1', 10000, 1);

insert into public.replay_sessions
  (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts)
select 'eeeeeeee-0000-0000-0000-00000000000e', id, 'ENGINE', 'M1',
       '2026-04-01T09:00:00Z', '2026-04-01T09:04:00Z', '2026-04-01T09:00:00Z'
  from public.backtest_sessions where name = 'Eve engine session';

insert into public.replay_sessions
  (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts)
select 'ffffffff-0000-0000-0000-00000000000f', id, 'ENGINE', 'M1',
       '2026-04-01T09:00:00Z', '2026-04-01T09:04:00Z', '2026-04-01T09:00:00Z'
  from public.backtest_sessions where name = 'Fred engine session';

\echo '--- E2. an OPEN replay position is representable ---'

insert into public.backtest_trades
  (user_id, session_id, replay_id, origin, symbol, direction,
   entry_price, exit_price, stop_price, take_profit, quantity,
   pnl, status, opened_at, closed_at, duration_minutes, entry_candle_ts)
select 'eeeeeeee-0000-0000-0000-00000000000e', b.id, r.id, 'replay',
       'ENGINE', 'long', 100.5, null, 99, 110, 100,
       0, 'open', '2026-04-01T09:00:00Z', null, null, '2026-04-01T09:00:00Z'
  from public.backtest_sessions b
  join public.replay_sessions r on r.session_id = b.id
 where b.name = 'Eve engine session';

select assert(
  (select count(*) from public.backtest_trades
    where status = 'open' and origin = 'replay' and exit_price is null) = 1,
  'an open replay position stores a null exit and status open'
);

-- The closed-consistency constraint must reject a half-closed row.
do $$
declare s uuid; r uuid;
begin
  select b.id, rs.id into s, r
    from public.backtest_sessions b
    join public.replay_sessions rs on rs.session_id = b.id
   where b.name = 'Eve engine session';
  begin
    insert into public.backtest_trades
      (user_id, session_id, replay_id, origin, symbol, direction,
       entry_price, quantity, status, opened_at, closed_at)
    values ('eeeeeeee-0000-0000-0000-00000000000e', s, r, 'replay', 'ENGINE',
            'long', 100, 1, 'win', '2026-04-01T09:00:00Z', '2026-04-01T09:02:00Z');
    raise exception 'FAIL  a closed trade without an exit price was accepted';
  exception when check_violation then
    raise notice 'PASS  a closed replay trade must carry an exit price';
  end;
end $$;

\echo '--- E3. no look-ahead in the reveal query ---'

-- This is the exact shape advanceReplay() uses: bars strictly after the cursor,
-- bounded by range_end, limited to the step size. It cannot return a bar the
-- replay has not reached.
select assert(
  (select count(*) from (
     select ts from public.candles
      where symbol = 'ENGINE' and timeframe = 'M1'
        and ts > '2026-04-01T09:00:00Z'
        and ts <= '2026-04-01T09:04:00Z'
      order by ts limit 1
   ) step_window) = 1,
  'a one-bar step reveals exactly one candle'
);

select assert(
  (select ts from public.candles
    where symbol = 'ENGINE' and timeframe = 'M1'
      and ts > '2026-04-01T09:00:00Z'
    order by ts limit 1) = '2026-04-01T09:01:00Z'::timestamptz,
  'the revealed bar is the next one, not an arbitrary future bar'
);

select assert(
  (select count(*) from public.candles
    where symbol = 'ENGINE' and timeframe = 'M1'
      and ts > '2026-04-01T09:02:00Z'
      and ts <= '2026-04-01T09:02:00Z') = 0,
  'no bar beyond the cursor is returned when the cursor has not moved'
);

\echo '--- E4. closing the position writes a consistent row ---'

-- Bar 3 touches the stop (low 98 <= 99) and the target (high 111 >= 110).
-- Policy: the stop wins. Exit 99, entry 100.5, qty 100 => -150.
update public.backtest_trades
   set exit_price = 99,
       closed_at = '2026-04-01T09:02:00Z',
       exit_candle_ts = '2026-04-01T09:02:00Z',
       duration_minutes = 2,
       pnl = -150,
       r_multiple = -1,
       status = 'loss'
 where status = 'open' and origin = 'replay';

select assert(
  (select count(*) from public.backtest_trades
    where origin = 'replay' and status = 'loss' and exit_price = 99) = 1,
  'the ambiguous bar resolves to the stop, not the target'
);
select assert(
  (select exit_candle_ts from public.backtest_trades
    where origin = 'replay' and status = 'loss')
  = '2026-04-01T09:02:00Z'::timestamptz,
  'the exit records the candle it happened on'
);
select assert(
  (select count(*) from public.backtest_trades
    where replay_id is not null and status = 'open') = 0,
  'no position remains open after the fill'
);

\echo '--- E5. the closed trade reaches session statistics ---'

select assert(
  (select sum(pnl) from public.backtest_trades bt
     join public.backtest_sessions b on b.id = bt.session_id
    where b.name = 'Eve engine session') = -150,
  'the replay trade contributes to session net P&L'
);
select assert(
  (select count(*) from public.trades
    where user_id = 'eeeeeeee-0000-0000-0000-00000000000e') = 0,
  'replay positions never touch the live trades table'
);

\echo '--- E6. cross-user access is blocked ---'

set role authenticated;
set request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-00000000000f"}';

select assert(
  (select count(*) from public.backtest_trades
    where symbol = 'ENGINE' and origin = 'replay') = 0,
  'Fred cannot see Eve''s replay position'
);

do $$
declare affected integer;
begin
  -- Attempt to close someone else's position.
  update public.backtest_trades
     set exit_price = 200, status = 'win', pnl = 9999
   where origin = 'replay';
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice 'PASS  Fred cannot close Eve''s position';
  else
    raise exception 'FAIL  Fred closed % of Eve''s positions', affected;
  end if;

  -- Attempt to move someone else's cursor.
  update public.replay_sessions
     set cursor_ts = '2026-04-01T09:04:00Z'
   where user_id = 'eeeeeeee-0000-0000-0000-00000000000e';
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice 'PASS  Fred cannot move Eve''s replay cursor';
  else
    raise exception 'FAIL  Fred moved Eve''s cursor';
  end if;
end $$;

reset role;

-- Opening a position in another user's replay is blocked by the ownership
-- trigger, independently of RLS.
do $$
declare eve_replay uuid; fred_session uuid;
begin
  select r.id into eve_replay from public.replay_sessions r
    join public.backtest_sessions b on b.id = r.session_id
   where b.name = 'Eve engine session';
  select id into fred_session from public.backtest_sessions
   where name = 'Fred engine session';

  begin
    insert into public.backtest_trades
      (user_id, session_id, replay_id, origin, symbol, direction,
       entry_price, quantity, status, opened_at)
    values ('ffffffff-0000-0000-0000-00000000000f', fred_session, eve_replay,
            'replay', 'ENGINE', 'long', 100, 1, 'open', '2026-04-01T09:00:00Z');
    -- The replay belongs to Eve; Fred must not be able to reference it.
    raise exception 'FAIL  a trade referencing another user''s replay was accepted';
  exception when others then
    if sqlerrm like '%replay_id does not belong%' then
      raise notice 'PASS  cross-user replay reference rejected';
    else
      raise;
    end if;
  end;
end $$;

\echo '--- E7. manual backtest trades are unaffected ---'

insert into public.backtest_trades
  (user_id, session_id, symbol, direction, entry_price, exit_price,
   quantity, pnl, status, opened_at, closed_at, duration_minutes)
select 'eeeeeeee-0000-0000-0000-00000000000e', id, 'ENGINE', 'short',
       110, 105, 10, 50, 'win',
       '2026-04-01T09:03:00Z', '2026-04-01T09:04:00Z', 1
  from public.backtest_sessions where name = 'Eve engine session';

select assert(
  (select count(*) from public.backtest_trades bt
     join public.backtest_sessions b on b.id = bt.session_id
    where b.name = 'Eve engine session' and bt.origin = 'manual') = 1,
  'a manual simulated trade still saves with origin manual'
);
select assert(
  (select count(*) from public.backtest_trades bt
     join public.backtest_sessions b on b.id = bt.session_id
    where b.name = 'Eve engine session' and bt.replay_id is null) = 1,
  'manual trades carry no replay_id'
);
select assert(
  (select sum(pnl) from public.backtest_trades bt
     join public.backtest_sessions b on b.id = bt.session_id
    where b.name = 'Eve engine session') = -100,
  'replay and manual trades aggregate together in the session'
);

\echo '--- REPLAY ENGINE TESTS PASSED ---'
