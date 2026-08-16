-- TRADAR — database smoke tests (TEST ONLY)
--
-- Exercises the production migrations against a real PostgreSQL instance:
--   1. signup provisioning (handle_new_user)
--   2. RLS isolation between two users
--   3. cross-table ownership guards
--   4. check constraints
--   5. the exact queries lib/data.ts issues
--
-- Run after 00_local_harness.sql, 0001_init.sql and 0002_rls.sql.
-- Any failed assertion raises an exception and aborts with a non-zero exit.

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

-- ---------------------------------------------------------------------------
-- 1. Signup provisioning
-- ---------------------------------------------------------------------------
\echo '--- 1. signup provisioning ---'

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{"full_name":"Alice Trader"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com',   '{"full_name":"Bob Trader"}');

select assert(
  (select count(*) from public.profiles) = 2,
  'signup creates one profile per user'
);

select assert(
  (select full_name from public.profiles
    where id = '11111111-1111-1111-1111-111111111111') = 'Alice Trader',
  'full_name is copied from signup metadata'
);

select assert(
  (select count(*) from public.trading_accounts
    where user_id = '11111111-1111-1111-1111-111111111111') = 1,
  'signup creates exactly one default trading account'
);

select assert(
  (select is_default from public.trading_accounts
    where user_id = '11111111-1111-1111-1111-111111111111'),
  'the provisioned account is marked default'
);

select assert(
  (select count(*) from public.progress_rules
    where user_id = '11111111-1111-1111-1111-111111111111') = 5,
  'signup creates the 5 default discipline rules'
);

-- ---------------------------------------------------------------------------
-- 2. Check constraints
-- ---------------------------------------------------------------------------
\echo '--- 2. check constraints ---'

do $$
declare acct uuid;
begin
  select id into acct from public.trading_accounts
   where user_id = '11111111-1111-1111-1111-111111111111';

  -- negative quantity must be rejected
  begin
    insert into public.trades
      (user_id, account_id, symbol, direction, entry_price, quantity, opened_at, status)
    values
      ('11111111-1111-1111-1111-111111111111', acct, 'EURUSD', 'long', 1.1, -5, now(), 'open');
    raise exception 'FAIL  negative quantity was accepted';
  exception when check_violation then
    raise notice 'PASS  negative quantity rejected';
  end;

  -- a closed trade with no exit price must be rejected
  begin
    insert into public.trades
      (user_id, account_id, symbol, direction, entry_price, quantity, opened_at, closed_at, status)
    values
      ('11111111-1111-1111-1111-111111111111', acct, 'EURUSD', 'long', 1.1, 1, now(), now(), 'win');
    raise exception 'FAIL  closed trade without exit price was accepted';
  exception when check_violation then
    raise notice 'PASS  closed trade requires an exit price';
  end;

  -- closed_at before opened_at must be rejected
  begin
    insert into public.trades
      (user_id, account_id, symbol, direction, entry_price, exit_price, quantity,
       opened_at, closed_at, status)
    values
      ('11111111-1111-1111-1111-111111111111', acct, 'EURUSD', 'long', 1.1, 1.2, 1,
       now(), now() - interval '1 hour', 'win');
    raise exception 'FAIL  closed_at before opened_at was accepted';
  exception when check_violation then
    raise notice 'PASS  closed_at must not precede opened_at';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cross-table ownership guard
-- ---------------------------------------------------------------------------
\echo '--- 3. ownership guards ---'

do $$
declare bob_acct uuid;
begin
  select id into bob_acct from public.trading_accounts
   where user_id = '22222222-2222-2222-2222-222222222222';

  -- Alice tries to attach a trade to Bob's account. RLS alone would allow
  -- this because the row's own user_id is Alice's.
  begin
    insert into public.trades
      (user_id, account_id, symbol, direction, entry_price, quantity, opened_at, status)
    values
      ('11111111-1111-1111-1111-111111111111', bob_acct, 'EURUSD', 'long', 1.1, 1, now(), 'open');
    raise exception 'FAIL  cross-user account attachment was accepted';
  exception when others then
    if sqlerrm like '%does not belong to the current user%' then
      raise notice 'PASS  cross-user account attachment blocked';
    else
      raise;
    end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Seed realistic trades for Alice (as the table owner, bypassing RLS)
-- ---------------------------------------------------------------------------
\echo '--- 4. seeding trades ---'

do $$
declare acct uuid;
begin
  select id into acct from public.trading_accounts
   where user_id = '11111111-1111-1111-1111-111111111111';

  update public.trading_accounts set starting_balance = 10000 where id = acct;

  insert into public.trades
    (user_id, account_id, symbol, direction, entry_price, exit_price, quantity,
     pnl, fees, status, opened_at, closed_at, duration_minutes, tags)
  values
    ('11111111-1111-1111-1111-111111111111', acct, 'EURUSD', 'long',  1.1000, 1.1100, 10000,
     100, 0, 'win',       '2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z', 60, '{breakout}'),
    ('11111111-1111-1111-1111-111111111111', acct, 'EURUSD', 'short', 1.1200, 1.1250, 10000,
     -50, 0, 'loss',      '2026-01-05T12:00:00Z', '2026-01-05T13:00:00Z', 60, '{fade}'),
    ('11111111-1111-1111-1111-111111111111', acct, 'GBPUSD', 'long',  1.2500, 1.2700, 10000,
     200, 0, 'win',       '2026-01-06T09:00:00Z', '2026-01-06T11:00:00Z', 120, '{trend}'),
    ('11111111-1111-1111-1111-111111111111', acct, 'GBPUSD', 'long',  1.2800, 1.2700, 10000,
     -100, 0, 'loss',     '2026-01-07T09:00:00Z', '2026-01-07T10:00:00Z', 60, '{trend}'),
    ('11111111-1111-1111-1111-111111111111', acct, 'USDJPY', 'short', 150.00, 149.50, 1000,
     50, 0, 'win',        '2026-01-08T09:00:00Z', '2026-01-08T10:00:00Z', 60, '{reversal}'),
    ('11111111-1111-1111-1111-111111111111', acct, 'USDJPY', 'long',  150.00, 150.00, 1000,
     0, 0, 'breakeven',   '2026-01-09T09:00:00Z', '2026-01-09T10:00:00Z', 60, '{}'),
    ('11111111-1111-1111-1111-111111111111', acct, 'AUDUSD', 'long',  0.6500, null, 10000,
     0, 0, 'open',        '2026-01-10T09:00:00Z', null, null, '{}');

  -- Bob gets one trade so isolation has something to hide.
  select id into acct from public.trading_accounts
   where user_id = '22222222-2222-2222-2222-222222222222';

  insert into public.trades
    (user_id, account_id, symbol, direction, entry_price, exit_price, quantity,
     pnl, status, opened_at, closed_at, duration_minutes)
  values
    ('22222222-2222-2222-2222-222222222222', acct, 'BTCUSD', 'long', 50000, 51000, 1,
     1000, 'win', '2026-01-05T09:00:00Z', '2026-01-05T12:00:00Z', 180);
end $$;

select assert((select count(*) from public.trades) = 8, 'seeded 8 trades total');

-- ---------------------------------------------------------------------------
-- 5. RLS isolation — the critical security property
-- ---------------------------------------------------------------------------
\echo '--- 5. RLS isolation ---'

-- Act as Alice, exactly the way PostgREST does.
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

select assert(auth.uid() = '11111111-1111-1111-1111-111111111111', 'auth.uid() resolves the JWT subject');
select assert((select count(*) from public.trades) = 7, 'Alice sees only her own 7 trades');
select assert((select count(*) from public.trading_accounts) = 1, 'Alice sees only her own account');
select assert((select count(*) from public.profiles) = 1, 'Alice sees only her own profile');
select assert(
  (select count(*) from public.trades where symbol = 'BTCUSD') = 0,
  'Alice cannot see Bob''s trade'
);

reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';

select assert((select count(*) from public.trades) = 1, 'Bob sees only his own 1 trade');
select assert(
  (select count(*) from public.trades where symbol = 'EURUSD') = 0,
  'Bob cannot see Alice''s trades'
);

-- Bob attempts to update Alice's rows directly. RLS must make them invisible,
-- so the statement affects zero rows rather than raising.
do $$
declare affected integer;
begin
  update public.trades set pnl = 999999 where symbol = 'EURUSD';
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice 'PASS  Bob cannot update Alice''s trades';
  else
    raise exception 'FAIL  Bob updated % of Alice''s trades', affected;
  end if;

  delete from public.trades where symbol = 'EURUSD';
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice 'PASS  Bob cannot delete Alice''s trades';
  else
    raise exception 'FAIL  Bob deleted % of Alice''s trades', affected;
  end if;
end $$;

-- Anonymous access must see nothing at all.
reset role;
set role anon;
select assert((select count(*) from public.trades) = 0, 'anonymous role sees no trades');
select assert((select count(*) from public.profiles) = 0, 'anonymous role sees no profiles');

reset role;

-- ---------------------------------------------------------------------------
-- 6. The queries lib/data.ts actually issues
-- ---------------------------------------------------------------------------
\echo '--- 6. application queries ---'

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

-- getTrades(): embedded strategy join must not error even with a null FK.
select assert(
  (select count(*) from public.trades t
    left join public.strategies s on s.id = t.strategy_id) = 7,
  'getTrades join over a nullable strategy_id works'
);

-- getPerformanceSummary() inputs: closed trades and their net P&L.
select assert(
  (select count(*) from public.trades where status <> 'open') = 6,
  'six closed trades feed the analytics engine'
);
select assert(
  (select coalesce(sum(pnl), 0) from public.trades where status <> 'open') = 200,
  'net realised P&L is 200'
);

-- journal upsert on the (user, date) unique constraint
insert into public.journal_entries (user_id, entry_date, pre_market_plan)
values ('11111111-1111-1111-1111-111111111111', '2026-01-05', 'first version');

insert into public.journal_entries (user_id, entry_date, pre_market_plan)
values ('11111111-1111-1111-1111-111111111111', '2026-01-05', 'second version')
on conflict (user_id, entry_date) do update
  set pre_market_plan = excluded.pre_market_plan;

select assert(
  (select count(*) from public.journal_entries where entry_date = '2026-01-05') = 1,
  'journal upsert updates rather than duplicating'
);
select assert(
  (select pre_market_plan from public.journal_entries where entry_date = '2026-01-05')
    = 'second version',
  'journal upsert stores the newest content'
);

-- strategies + attaching a trade to one
insert into public.strategies (user_id, name, market, timeframe)
values ('11111111-1111-1111-1111-111111111111', 'London breakout', 'FX', 'M15');

update public.trades
   set strategy_id = (select id from public.strategies where name = 'London breakout')
 where symbol = 'EURUSD';

select assert(
  (select count(*) from public.trades where strategy_id is not null) = 2,
  'trades can be attached to a strategy'
);

-- progress completion upsert on (rule_id, completion_date)
insert into public.progress_completions (user_id, rule_id, completion_date, completed)
select '11111111-1111-1111-1111-111111111111', id, '2026-01-05', true
  from public.progress_rules
 where user_id = '11111111-1111-1111-1111-111111111111'
 limit 1;

insert into public.progress_completions (user_id, rule_id, completion_date, completed)
select '11111111-1111-1111-1111-111111111111', id, '2026-01-05', false
  from public.progress_rules
 where user_id = '11111111-1111-1111-1111-111111111111'
 limit 1
on conflict (rule_id, completion_date) do update
  set completed = excluded.completed;

select assert(
  (select count(*) from public.progress_completions where completion_date = '2026-01-05') = 1,
  'progress toggle upserts rather than duplicating'
);

reset role;

-- ---------------------------------------------------------------------------
-- 7. Cascade behaviour
-- ---------------------------------------------------------------------------
\echo '--- 7. cascade behaviour ---'

-- Deleting a strategy must preserve trade history (ON DELETE SET NULL).
delete from public.strategies where name = 'London breakout';

select assert(
  (select count(*) from public.trades
    where user_id = '11111111-1111-1111-1111-111111111111') = 7,
  'deleting a strategy preserves the trades that used it'
);
select assert(
  (select count(*) from public.trades where strategy_id is not null) = 0,
  'strategy_id is nulled rather than cascading the delete'
);

-- Deleting the user must remove all of their data.
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';

select assert(
  (select count(*) from public.trades
    where user_id = '22222222-2222-2222-2222-222222222222') = 0,
  'deleting a user cascades their trades'
);
select assert(
  (select count(*) from public.profiles
    where id = '22222222-2222-2222-2222-222222222222') = 0,
  'deleting a user cascades their profile'
);

\echo '--- ALL DATABASE TESTS PASSED ---'

-- ---------------------------------------------------------------------------
-- 8. Backtesting: sessions and simulated trades
-- ---------------------------------------------------------------------------
\echo '--- 8. backtesting ---'

-- Recreate a second user; section 7 deleted Bob.
insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'erin@example.com');

insert into public.backtest_sessions (user_id, name, symbol, timeframe, initial_balance, notes)
values
  ('11111111-1111-1111-1111-111111111111', 'Alice session', 'EURUSD', 'M15', 10000, 'alice notes'),
  ('66666666-6666-6666-6666-666666666666', 'Erin session',  'BTCUSD', 'H1',  5000,  'erin notes');

select assert(
  (select count(*) from public.backtest_sessions) = 2,
  'backtest sessions created for two users'
);

-- Simulated trades in each user's own session
insert into public.backtest_trades
  (user_id, session_id, symbol, direction, entry_price, exit_price, quantity,
   pnl, status, opened_at, closed_at, duration_minutes)
select '11111111-1111-1111-1111-111111111111', id, 'EURUSD', 'long', 1.10, 1.11, 10000,
       100, 'win', '2026-02-01T09:00:00Z', '2026-02-01T10:00:00Z', 60
  from public.backtest_sessions where name = 'Alice session';

insert into public.backtest_trades
  (user_id, session_id, symbol, direction, entry_price, exit_price, quantity,
   pnl, status, opened_at, closed_at, duration_minutes)
select '66666666-6666-6666-6666-666666666666', id, 'BTCUSD', 'long', 50000, 49000, 1,
       -1000, 'loss', '2026-02-01T09:00:00Z', '2026-02-01T12:00:00Z', 180
  from public.backtest_sessions where name = 'Erin session';

-- A user must not be able to put a trade into someone else's session.
do $$
declare erin_session uuid;
begin
  select id into erin_session from public.backtest_sessions where name = 'Erin session';
  begin
    insert into public.backtest_trades
      (user_id, session_id, symbol, direction, entry_price, quantity, opened_at, status)
    values
      ('11111111-1111-1111-1111-111111111111', erin_session, 'EURUSD', 'long', 1.1, 1, now(), 'open');
    raise exception 'FAIL  cross-user session insert was accepted';
  exception when others then
    if sqlerrm like '%session_id does not belong%' then
      raise notice 'PASS  cross-user simulated trade insert blocked';
    else
      raise;
    end if;
  end;
end $$;

-- Closed-consistency constraint applies to simulated trades too.
do $$
declare s uuid;
begin
  select id into s from public.backtest_sessions where name = 'Alice session';
  begin
    insert into public.backtest_trades
      (user_id, session_id, symbol, direction, entry_price, quantity, opened_at, closed_at, status)
    values
      ('11111111-1111-1111-1111-111111111111', s, 'EURUSD', 'long', 1.1, 1, now(), now(), 'win');
    raise exception 'FAIL  closed simulated trade without exit price accepted';
  exception when check_violation then
    raise notice 'PASS  simulated trade requires an exit price to close';
  end;
end $$;

-- RLS isolation for backtesting
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

select assert(
  (select count(*) from public.backtest_sessions) = 1,
  'Alice sees only her own backtest session'
);
select assert(
  (select count(*) from public.backtest_trades) = 1,
  'Alice sees only her own simulated trades'
);
select assert(
  (select count(*) from public.backtest_trades where symbol = 'BTCUSD') = 0,
  'Alice cannot see Erin''s simulated trades'
);

do $$
declare affected integer;
begin
  update public.backtest_sessions set name = 'hijacked' where name = 'Erin session';
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice 'PASS  Alice cannot update Erin''s session';
  else
    raise exception 'FAIL  Alice updated Erin''s session';
  end if;

  delete from public.backtest_sessions where name = 'Erin session';
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice 'PASS  Alice cannot delete Erin''s session';
  else
    raise exception 'FAIL  Alice deleted Erin''s session';
  end if;

  delete from public.backtest_trades where symbol = 'BTCUSD';
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice 'PASS  Alice cannot delete Erin''s simulated trades';
  else
    raise exception 'FAIL  Alice deleted Erin''s simulated trades';
  end if;
end $$;

reset role;
set role anon;
select assert(
  (select count(*) from public.backtest_sessions) = 0,
  'anonymous role sees no backtest sessions'
);
select assert(
  (select count(*) from public.backtest_trades) = 0,
  'anonymous role sees no simulated trades'
);
reset role;

-- Deleting a session removes its simulated trades.
delete from public.backtest_sessions where name = 'Alice session';
select assert(
  (select count(*) from public.backtest_trades where symbol = 'EURUSD') = 0,
  'deleting a session cascades its simulated trades'
);

\echo '--- BACKTESTING TESTS PASSED ---'
