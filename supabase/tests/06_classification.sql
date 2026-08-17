-- TRADAR — trade classification and strategy ownership
--
-- Confirms the two new columns persist, their length constraints hold, and that
-- a user cannot attach another user's strategy to a trade. Manual and replay
-- trades must both carry classification through the same columns so one
-- analytics path serves both.

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

\echo '--- C1. fixtures ---'

insert into auth.users (id, email) values
  ('22220000-0000-0000-0000-000000000001', 'clara@example.com'),
  ('33330000-0000-0000-0000-000000000002', 'dan@example.com');

insert into public.strategies (user_id, name, market, timeframe) values
  ('22220000-0000-0000-0000-000000000001', 'Clara Ichimoku', 'FX', 'M15'),
  ('33330000-0000-0000-0000-000000000002', 'Dan FVG', 'FX', 'M5');

insert into public.backtest_sessions (user_id, name, symbol, timeframe, initial_balance, risk_per_trade) values
  ('22220000-0000-0000-0000-000000000001', 'Clara session', 'CLS', 'M15', 10000, 1),
  ('33330000-0000-0000-0000-000000000002', 'Dan session', 'CLS', 'M5', 10000, 1);

\echo '--- C2. classification persists on a replay trade ---'

insert into public.replay_sessions
  (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts)
select '22220000-0000-0000-0000-000000000001', id, 'CLS', 'M15',
       '2026-06-01T09:00:00Z', '2026-06-01T17:00:00Z', '2026-06-01T09:00:00Z'
  from public.backtest_sessions where name = 'Clara session';

insert into public.backtest_trades
  (user_id, session_id, replay_id, strategy_id, origin, symbol, direction,
   entry_price, exit_price, quantity, pnl, r_multiple, status,
   opened_at, closed_at, duration_minutes, setup, market_session, tags, notes)
select '22220000-0000-0000-0000-000000000001', b.id, r.id, s.id, 'replay',
       'CLS', 'long', 100, 102, 10, 20, 2, 'win',
       '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z', 60,
       'A+', 'London', array['FVG','Liquidity sweep'],
       '4H bias bullish, 15M FVG.'
  from public.backtest_sessions b
  join public.replay_sessions r on r.session_id = b.id
  join public.strategies s on s.user_id = b.user_id
 where b.name = 'Clara session';

select assert(
  (select setup from public.backtest_trades where symbol = 'CLS') = 'A+',
  'setup persists on a replay trade'
);
select assert(
  (select market_session from public.backtest_trades where symbol = 'CLS') = 'London',
  'market_session persists and is distinct from the backtest session'
);
select assert(
  (select array_length(tags, 1) from public.backtest_trades where symbol = 'CLS') = 2,
  'multiple tags persist'
);
select assert(
  (select strategy_id is not null from public.backtest_trades where symbol = 'CLS'),
  'strategy is attached'
);

\echo '--- C3. length constraints ---'

do $$
declare s uuid;
begin
  select id into s from public.backtest_sessions where name = 'Clara session';

  begin
    insert into public.backtest_trades
      (user_id, session_id, symbol, direction, entry_price, quantity, status, opened_at, setup)
    values ('22220000-0000-0000-0000-000000000001', s, 'CLS', 'long', 100, 1,
            'open', now(), repeat('x', 41));
    raise exception 'FAIL  an over-long setup was accepted';
  exception when check_violation then
    raise notice 'PASS  over-long setup rejected';
  end;

  begin
    insert into public.backtest_trades
      (user_id, session_id, symbol, direction, entry_price, quantity, status, opened_at, market_session)
    values ('22220000-0000-0000-0000-000000000001', s, 'CLS', 'long', 100, 1,
            'open', now(), repeat('y', 41));
    raise exception 'FAIL  an over-long market_session was accepted';
  exception when check_violation then
    raise notice 'PASS  over-long market_session rejected';
  end;
end $$;

-- Classification is optional: a trade with neither field must be accepted.
insert into public.backtest_trades
  (user_id, session_id, symbol, direction, entry_price, exit_price, quantity,
   pnl, status, opened_at, closed_at, duration_minutes)
select '22220000-0000-0000-0000-000000000001', id, 'CLSNONE', 'short',
       100, 99, 10, 10, 'win',
       '2026-06-01T11:00:00Z', '2026-06-01T12:00:00Z', 60
  from public.backtest_sessions where name = 'Clara session';

select assert(
  (select setup is null and market_session is null
     from public.backtest_trades where symbol = 'CLSNONE'),
  'classification is optional — an unclassified trade is accepted'
);

\echo '--- C4. strategy ownership ---'

-- Clara may attach her own strategy: already proven in C2.
select assert(
  (select count(*) from public.backtest_trades bt
     join public.strategies s on s.id = bt.strategy_id
    where s.user_id = '22220000-0000-0000-0000-000000000001') = 1,
  'a user can attach their OWN strategy'
);

-- Clara must not be able to attach Dan's strategy, even by guessing its uuid.
do $$
declare clara_session uuid; dan_strategy uuid;
begin
  select id into clara_session from public.backtest_sessions where name = 'Clara session';
  select id into dan_strategy from public.strategies where name = 'Dan FVG';

  begin
    insert into public.backtest_trades
      (user_id, session_id, strategy_id, symbol, direction,
       entry_price, quantity, status, opened_at)
    values ('22220000-0000-0000-0000-000000000001', clara_session, dan_strategy,
            'CLS', 'long', 100, 1, 'open', now());
    raise exception 'FAIL  another user''s strategy was attached';
  exception when others then
    if sqlerrm like '%strategy_id does not belong%' then
      raise notice 'PASS  a user cannot attach another user''s strategy';
    else
      raise;
    end if;
  end;
end $$;

\echo '--- C5. manual trades share the same classification columns ---'

insert into public.backtest_trades
  (user_id, session_id, strategy_id, symbol, direction, entry_price, exit_price,
   quantity, pnl, r_multiple, status, opened_at, closed_at, duration_minutes,
   setup, market_session, tags)
select '22220000-0000-0000-0000-000000000001', b.id, s.id, 'CLSMAN', 'long',
       100, 101, 10, 10, 1, 'win',
       '2026-06-01T13:00:00Z', '2026-06-01T14:00:00Z', 60,
       'B+', 'New York', array['BOS']
  from public.backtest_sessions b
  join public.strategies s on s.user_id = b.user_id
 where b.name = 'Clara session';

select assert(
  (select origin from public.backtest_trades where symbol = 'CLSMAN') = 'manual',
  'the manual trade defaults to origin manual'
);
select assert(
  (select setup from public.backtest_trades where symbol = 'CLSMAN') = 'B+',
  'a manual trade carries classification through the same columns'
);

-- One analytics path: both origins are classified and closed, so grouping by
-- setup sees them together.
select assert(
  (select count(distinct setup) from public.backtest_trades
    where session_id = (select id from public.backtest_sessions where name = 'Clara session')
      and setup is not null) = 2,
  'replay and manual trades are grouped by the same setup column'
);

\echo '--- C6. RLS still isolates classification ---'

set role authenticated;
set request.jwt.claims = '{"sub":"33330000-0000-0000-0000-000000000002"}';
select assert(
  (select count(*) from public.backtest_trades where symbol like 'CLS%') = 0,
  'Dan cannot read Clara''s classified trades'
);
reset role;

set role authenticated;
set request.jwt.claims = '{"sub":"22220000-0000-0000-0000-000000000001"}';
select assert(
  (select count(*) from public.backtest_trades where symbol like 'CLS%') = 3,
  'Clara reads her own classified trades'
);
reset role;

\echo '--- CLASSIFICATION TESTS PASSED ---'
