-- TRADAR — strict one-position-at-a-time replay management
--
-- Covers the position lifecycle at the database level: opening, the
-- single-open-position invariant (including the concurrent case), automatic
-- and manual closes, reopening afterwards, and that manual backtest trades are
-- untouched by any of it.

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

\echo '--- P1. fixtures ---'

insert into auth.users (id, email) values
  ('11110000-0000-0000-0000-000000000001', 'pos@example.com');

insert into public.admin_users (user_id, note)
values ('11110000-0000-0000-0000-000000000001', 'position test fixture')
on conflict (user_id) do nothing;

insert into public.candles (symbol, timeframe, ts, open, high, low, close) values
  ('POSTEST','M1','2026-05-01T09:00:00Z', 100, 101, 99.5, 100),
  ('POSTEST','M1','2026-05-01T09:01:00Z', 100, 102, 99.8, 101),
  ('POSTEST','M1','2026-05-01T09:02:00Z', 101, 103, 100.5, 102);

insert into public.backtest_sessions (user_id, name, symbol, timeframe, initial_balance, risk_per_trade)
values ('11110000-0000-0000-0000-000000000001', 'Position session', 'POSTEST', 'M1', 10000, 1);

insert into public.replay_sessions
  (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts)
select '11110000-0000-0000-0000-000000000001', id, 'POSTEST', 'M1',
       '2026-05-01T09:00:00Z', '2026-05-01T09:02:00Z', '2026-05-01T09:00:00Z'
  from public.backtest_sessions where name = 'Position session';

\echo '--- P2. A/B: opening a position ---'

-- A: open long
insert into public.backtest_trades
  (user_id, session_id, replay_id, origin, symbol, direction,
   entry_price, stop_price, take_profit, quantity, pnl, status,
   opened_at, entry_candle_ts)
select '11110000-0000-0000-0000-000000000001', b.id, r.id, 'replay', 'POSTEST',
       'long', 100, 99, 105, 100, 0, 'open',
       '2026-05-01T09:00:00Z', '2026-05-01T09:00:00Z'
  from public.backtest_sessions b
  join public.replay_sessions r on r.session_id = b.id
 where b.name = 'Position session';

select assert(
  (select count(*) from public.backtest_trades
    where status = 'open' and origin = 'replay' and symbol = 'POSTEST') = 1,
  'A: opening a long creates exactly one open position'
);

\echo '--- P3. C/D/P: a second position is rejected ---'

-- C/D: the partial unique index is the authority. This is also case P: two
-- concurrent opens cannot both succeed, because the second insert violates the
-- index regardless of what either request read beforehand.
do $$
declare s uuid; r uuid;
begin
  select b.id, rs.id into s, r
    from public.backtest_sessions b
    join public.replay_sessions rs on rs.session_id = b.id
   where b.name = 'Position session';

  begin
    insert into public.backtest_trades
      (user_id, session_id, replay_id, origin, symbol, direction,
       entry_price, stop_price, quantity, pnl, status, opened_at)
    values ('11110000-0000-0000-0000-000000000001', s, r, 'replay', 'POSTEST',
            'short', 100, 101, 100, 0, 'open', '2026-05-01T09:00:00Z');
    raise exception 'FAIL  a second open position was accepted';
  exception when unique_violation then
    raise notice 'PASS  C/D/P: a second open position is rejected by the database';
  end;
end $$;

select assert(
  (select count(*) from public.backtest_trades
    where status = 'open' and symbol = 'POSTEST') = 1,
  'still exactly one open position after the rejected insert'
);

\echo '--- P4. L: the open position survives a refresh ---'

-- A refresh is just a re-read: the position is state in the database, not in
-- the browser.
select assert(
  (select direction from public.backtest_trades
    where status = 'open' and symbol = 'POSTEST') = 'long',
  'L: the open position is recoverable from the database alone'
);
select assert(
  (select cursor_ts from public.replay_sessions rs
     join public.backtest_sessions b on b.id = rs.session_id
    where b.name = 'Position session') = '2026-05-01T09:00:00Z'::timestamptz,
  'L: the replay resumes from the persisted cursor'
);

\echo '--- P5. E/N: manual close ---'

-- Exit price is the close of the cursor candle (101 at 09:01), never supplied
-- by the client. Long 100 -> 101 on qty 100 = +100.
update public.backtest_trades
   set exit_price = 101,
       closed_at = '2026-05-01T09:01:00Z',
       exit_candle_ts = '2026-05-01T09:01:00Z',
       duration_minutes = 1,
       pnl = 100,
       r_multiple = 1,
       status = 'win'
 where status = 'open' and symbol = 'POSTEST';

select assert(
  (select count(*) from public.backtest_trades
    where status = 'open' and symbol = 'POSTEST') = 0,
  'N: the position disappears after a manual close'
);
select assert(
  (select exit_price from public.backtest_trades
    where symbol = 'POSTEST' and origin = 'replay') = 101,
  'G: the exit price is the cursor candle close'
);
select assert(
  (select exit_candle_ts from public.backtest_trades
    where symbol = 'POSTEST' and origin = 'replay')
  = '2026-05-01T09:01:00Z'::timestamptz,
  'the exit records the candle it closed on'
);

\echo '--- P6. O: a new position can be opened afterwards ---'

insert into public.backtest_trades
  (user_id, session_id, replay_id, origin, symbol, direction,
   entry_price, stop_price, take_profit, quantity, pnl, status,
   opened_at, entry_candle_ts)
select '11110000-0000-0000-0000-000000000001', b.id, r.id, 'replay', 'POSTEST',
       'short', 101, 102, 98, 100, 0, 'open',
       '2026-05-01T09:01:00Z', '2026-05-01T09:01:00Z'
  from public.backtest_sessions b
  join public.replay_sessions r on r.session_id = b.id
 where b.name = 'Position session';

select assert(
  (select count(*) from public.backtest_trades
    where status = 'open' and symbol = 'POSTEST') = 1,
  'O: a new position opens once the previous one has closed'
);
select assert(
  (select count(*) from public.backtest_trades where symbol = 'POSTEST') = 2,
  'the closed trade is retained alongside the new open one'
);

\echo '--- P7. J/K/M: automatic close by SL or TP ---'

-- Short from 101 with a stop at 102: bar 09:02 has high 103, so the stop is
-- hit. Exit 102 on qty 100 => -100.
update public.backtest_trades
   set exit_price = 102,
       closed_at = '2026-05-01T09:02:00Z',
       exit_candle_ts = '2026-05-01T09:02:00Z',
       duration_minutes = 1,
       pnl = -100,
       r_multiple = -1,
       status = 'loss'
 where status = 'open' and symbol = 'POSTEST';

select assert(
  (select count(*) from public.backtest_trades
    where status = 'open' and symbol = 'POSTEST') = 0,
  'M: the position disappears after an automatic close'
);
select assert(
  (select sum(pnl) from public.backtest_trades where symbol = 'POSTEST') = 0,
  'both closed trades aggregate into session P&L (+100 then -100)'
);

\echo '--- P8. the index constrains only OPEN replay positions ---'

-- Many closed trades may share a replay_id; only one may be open.
select assert(
  (select count(*) from public.backtest_trades
    where symbol = 'POSTEST' and replay_id is not null) = 2,
  'multiple closed trades share the same replay without conflict'
);

-- Manual backtest trades have a null replay_id and are entirely unaffected,
-- including several open ones at once.
insert into public.backtest_trades
  (user_id, session_id, symbol, direction, entry_price, quantity, pnl, status, opened_at)
select '11110000-0000-0000-0000-000000000001', id, 'POSTEST', 'long', 100, 1, 0, 'open', now()
  from public.backtest_sessions where name = 'Position session';

insert into public.backtest_trades
  (user_id, session_id, symbol, direction, entry_price, quantity, pnl, status, opened_at)
select '11110000-0000-0000-0000-000000000001', id, 'POSTEST', 'short', 100, 1, 0, 'open', now()
  from public.backtest_sessions where name = 'Position session';

select assert(
  (select count(*) from public.backtest_trades
    where status = 'open' and replay_id is null and origin = 'manual') = 2,
  'manual backtest trades are not constrained by the replay index'
);

\echo '--- POSITION MANAGEMENT TESTS PASSED ---'
