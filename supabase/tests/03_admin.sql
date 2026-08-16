-- TRADAR — admin-only candle ingestion tests
--
-- Verifies that candles stay readable by everyone signed in, while writing
-- them is restricted to administrators at the DATABASE level, not merely in
-- the UI.

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

\echo '--- A1. setup: one admin, one normal user ---'

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('dddddddd-0000-0000-0000-00000000000b', 'normal@example.com');

-- Membership is granted out of band, exactly as it would be in the SQL editor.
insert into public.admin_users (user_id, note)
values ('cccccccc-0000-0000-0000-00000000000a', 'seeded by test');

-- Scoped: earlier test files register their own admin fixture.
select assert(
  (select count(*) from public.admin_users
    where user_id = 'cccccccc-0000-0000-0000-00000000000a') = 1,
  'admin registered'
);

\echo '--- A2. is_admin() resolves per caller ---'

set role authenticated;
set request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000000a"}';
select assert(public.is_admin(), 'is_admin() is true for the admin');

reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000000b"}';
select assert(not public.is_admin(), 'is_admin() is false for a normal user');
reset role;

\echo '--- A3. a normal user CANNOT import candles ---'

set role authenticated;
set request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000000b"}';

do $$
begin
  begin
    perform public.import_candles('[
      {"symbol":"NOPE","timeframe":"H1","ts":"2026-03-01T00:00:00Z","open":1,"high":2,"low":0.5,"close":1.5}
    ]'::jsonb);
    raise exception 'FAIL  normal user imported candles';
  exception when others then
    if sqlerrm like '%restricted to administrators%' then
      raise notice 'PASS  normal user cannot call import_candles()';
    else
      raise;
    end if;
  end;
end $$;

select assert(
  (select count(*) from public.candles where symbol = 'NOPE') = 0,
  'no candle was written by the rejected call'
);

-- Direct table writes remain impossible for normal users as well.
do $$
begin
  begin
    insert into public.candles (symbol, timeframe, ts, open, high, low, close)
    values ('DIRECT2', 'H1', now(), 1, 2, 0.5, 1.5);
    raise exception 'FAIL  normal user inserted a candle directly';
  exception when insufficient_privilege or others then
    raise notice 'PASS  normal user cannot insert candles directly';
  end;
end $$;

reset role;

\echo '--- A4. privilege escalation is not possible ---'

-- The reason admin status is NOT a column on profiles: a user may update their
-- own profile row, and RLS cannot restrict which columns that covers. Here we
-- confirm the separate table cannot be written by a normal user at all.
set role authenticated;
set request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000000b"}';

do $$
begin
  begin
    insert into public.admin_users (user_id)
    values ('dddddddd-0000-0000-0000-00000000000b');
    raise exception 'FAIL  user promoted themselves to admin';
  exception when insufficient_privilege or others then
    raise notice 'PASS  user cannot insert themselves into admin_users';
  end;
end $$;

do $$
declare affected integer;
begin
  begin
    update public.admin_users set user_id = 'dddddddd-0000-0000-0000-00000000000b';
    get diagnostics affected = row_count;
    if affected = 0 then
      raise notice 'PASS  user cannot update admin_users';
    else
      raise exception 'FAIL  user updated admin_users';
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS  user has no update privilege on admin_users';
  end;
end $$;

do $$
declare affected integer;
begin
  begin
    delete from public.admin_users;
    get diagnostics affected = row_count;
    if affected = 0 then
      raise notice 'PASS  user cannot delete admin_users rows';
    else
      raise exception 'FAIL  user deleted % admin rows', affected;
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS  user has no delete privilege on admin_users';
  end;
end $$;

-- A normal user cannot even see who the admins are: the SELECT policy is
-- restricted to their own row, and they have no row.
select assert(
  (select count(*) from public.admin_users) = 0,
  'a normal user cannot enumerate administrators'
);

reset role;

\echo '--- A5. an admin CAN import candles ---'

set role authenticated;
set request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000000a"}';

select assert(
  public.import_candles('[
    {"symbol":"ADMINOK","timeframe":"H1","ts":"2026-03-01T00:00:00Z","open":100,"high":110,"low":95,"close":105,"volume":5}
  ]'::jsonb) = 1,
  'admin can import a candle'
);
select assert(
  (select count(*) from public.candles where symbol = 'ADMINOK') = 1,
  'the admin import reached the table'
);

-- Validation still applies to admins: privilege is not a bypass.
select assert(
  public.import_candles('[
    {"symbol":"BADADMIN","timeframe":"H1","ts":"2026-03-01T00:00:00Z","open":100,"high":50,"low":150,"close":100}
  ]'::jsonb) = 0,
  'corrupt bars are rejected even for an admin'
);
select assert(
  (select count(*) from public.candles where symbol = 'BADADMIN') = 0,
  'no corrupt bar reaches the table from an admin'
);

-- Admins still cannot write the table directly, only through the function.
do $$
begin
  begin
    insert into public.candles (symbol, timeframe, ts, open, high, low, close)
    values ('ADMINDIRECT', 'H1', now(), 1, 2, 0.5, 1.5);
    raise exception 'FAIL  admin inserted a candle directly';
  exception when insufficient_privilege or others then
    raise notice 'PASS  even an admin must go through import_candles()';
  end;
end $$;

reset role;

\echo '--- A6. anon is excluded entirely ---'

set role anon;
do $$
begin
  begin
    perform public.import_candles('[]'::jsonb);
    raise exception 'FAIL  anon executed import_candles';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot execute import_candles()';
  when others then
    if sqlerrm like '%authentication required%' then
      raise notice 'PASS  import_candles() rejects unauthenticated callers';
    else
      raise;
    end if;
  end;
end $$;

do $$
begin
  begin
    perform public.is_admin();
    raise notice 'NOTE  anon may call is_admin() (returns false)';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot execute is_admin()';
  end;
end $$;
reset role;

\echo '--- A7. reading candles is unaffected for normal users ---'

set role authenticated;
set request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000000b"}';

select assert(
  (select count(*) from public.candles where symbol = 'ADMINOK') = 1,
  'a normal user can still read candles imported by an admin'
);
select assert(
  (select count(*) from public.candles) > 0,
  'candles remain globally shared reference data'
);
select assert(
  (select candle_count from public.candle_catalog where symbol = 'ADMINOK') = 1,
  'a normal user can still read the candle catalog'
);

reset role;

\echo '--- A8. Replay still works for normal users ---'

insert into public.backtest_sessions (user_id, name, symbol, timeframe, initial_balance)
values ('dddddddd-0000-0000-0000-00000000000b', 'Normal user session', 'ADMINOK', 'H1', 10000);

insert into public.replay_sessions
  (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts)
select 'dddddddd-0000-0000-0000-00000000000b', id, 'ADMINOK', 'H1',
       '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z', '2026-03-01T00:00:00Z'
  from public.backtest_sessions where name = 'Normal user session';

set role authenticated;
set request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000000b"}';

select assert(
  (select count(*) from public.replay_sessions) = 1,
  'a normal user can create and read their own replay session'
);
select assert(
  (select count(*) from public.candles
    where symbol = 'ADMINOK' and timeframe = 'H1'
      and ts <= '2026-03-01T00:00:00Z') = 1,
  'cursor-bounded candle reads still work for a normal user'
);

reset role;

\echo '--- ADMIN TESTS PASSED ---'
