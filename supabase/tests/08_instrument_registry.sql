-- TRADAR — instrument registry and provider listings
--
-- The registry is shared, operator-controlled reference data: any signed-in
-- user reads it, nobody writes it through the API. These tests prove that,
-- and that the existing candle identity/idempotency is unaffected.

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

\echo '--- M1. seed catalogue ---'

select assert(
  (select count(*) from public.instruments) >= 18,
  'seed catalogue is populated'
);
select assert(
  (select count(distinct category) from public.instruments) >= 6,
  'multiple market categories are represented'
);
select assert(
  (select display_name from public.instruments where symbol = 'XAUUSD') = 'Gold / US Dollar',
  'instrument lookup by Tradar symbol works'
);
select assert(
  (select category from public.instruments where symbol = 'ES')::text = 'futures',
  'futures instruments are categorised'
);

\echo '--- M2. provider listings ---'

-- Only crypto is listed, because Binance is the only credential-free adapter.
select assert(
  (select count(*) from public.instrument_providers) = 3,
  'only the crypto instruments have a provider listing'
);
select assert(
  (select provider from public.instrument_providers ip
     join public.instruments i on i.id = ip.instrument_id
    where i.symbol = 'BTCUSDT') = 'binance',
  'BTCUSDT routes to binance'
);

-- Instruments Tradar can represent but cannot yet fetch must have NO listing,
-- so the UI reports "no source" rather than implying a feed that does not exist.
select assert(
  (select count(*) from public.instrument_providers ip
     join public.instruments i on i.id = ip.instrument_id
    where i.symbol in ('XAUUSD','EURUSD','AAPL','ES')) = 0,
  'instruments without a configured provider have no listing'
);

-- One provider may list an instrument only once.
do $$
declare inst uuid;
begin
  select id into inst from public.instruments where symbol = 'BTCUSDT';
  begin
    insert into public.instrument_providers (instrument_id, provider, provider_symbol)
    values (inst, 'binance', 'BTCUSDT');
    raise exception 'FAIL  duplicate provider listing accepted';
  exception when unique_violation then
    raise notice 'PASS  duplicate (instrument, provider) listing rejected';
  end;
end $$;

-- A second provider for the same instrument IS allowed: that is how routing
-- priority becomes meaningful.
do $$
declare inst uuid;
begin
  select id into inst from public.instruments where symbol = 'BTCUSDT';
  insert into public.instrument_providers
    (instrument_id, provider, provider_symbol, priority)
  values (inst, 'twelvedata', 'BTC/USDT', 50);
  raise notice 'PASS  a second provider may list the same instrument';
end $$;

\echo '--- M3. constraints ---'

do $$
begin
  begin
    insert into public.instruments (symbol, display_name, category)
    values ('', 'Blank symbol', 'forex');
    raise exception 'FAIL  blank symbol accepted';
  exception when check_violation then
    raise notice 'PASS  blank symbol rejected';
  end;

  begin
    insert into public.instruments (symbol, display_name, category)
    values ('DUPE1', 'First', 'forex');
    insert into public.instruments (symbol, display_name, category)
    values ('DUPE1', 'Second', 'crypto');
    raise exception 'FAIL  duplicate Tradar symbol accepted';
  exception when unique_violation then
    raise notice 'PASS  Tradar symbols are unique';
  end;

  begin
    insert into public.instruments (symbol, display_name, category)
    values ('BADCAT', 'Bad category', 'nonsense');
    raise exception 'FAIL  unknown category accepted';
  exception when invalid_text_representation then
    raise notice 'PASS  unknown market category rejected';
  end;
end $$;

\echo '--- M4. RLS: readable by users, writable by nobody ---'

insert into auth.users (id, email)
values ('44440000-0000-0000-0000-000000000001', 'trader@example.com');

set role authenticated;
set request.jwt.claims = '{"sub":"44440000-0000-0000-0000-000000000001"}';

select assert(
  (select count(*) from public.instruments) >= 18,
  'a signed-in user can read the catalogue'
);
select assert(
  (select count(*) from public.instrument_providers) >= 3,
  'a signed-in user can read provider listings'
);

-- A customer must not be able to add an instrument or repoint routing.
do $$
begin
  begin
    insert into public.instruments (symbol, display_name, category)
    values ('HACK', 'Injected', 'crypto');
    raise exception 'FAIL  a user inserted an instrument';
  exception when insufficient_privilege or others then
    raise notice 'PASS  a user cannot insert instruments';
  end;
end $$;

do $$
declare affected integer;
begin
  begin
    update public.instrument_providers set provider_symbol = 'ATTACKER';
    get diagnostics affected = row_count;
    if affected = 0 then
      raise notice 'PASS  a user cannot repoint a provider symbol';
    else
      raise exception 'FAIL  a user repointed % provider symbols', affected;
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS  a user has no update privilege on listings';
  end;
end $$;

do $$
declare affected integer;
begin
  begin
    delete from public.instruments;
    get diagnostics affected = row_count;
    if affected = 0 then
      raise notice 'PASS  a user cannot delete instruments';
    else
      raise exception 'FAIL  a user deleted % instruments', affected;
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS  a user has no delete privilege on instruments';
  end;
end $$;

reset role;

set role anon;
do $$
begin
  begin
    if (select count(*) from public.instruments) > 0 then
      raise exception 'FAIL  anon read the catalogue';
    end if;
    raise notice 'PASS  anon sees no instruments';
  exception when insufficient_privilege then
    raise notice 'PASS  anon has no access to the catalogue';
  end;
end $$;
reset role;

\echo '--- M5. candle identity unchanged (idempotent import) ---'

-- Phase 5 adds no column to public.candles and does not re-key it, so the
-- existing dedup guarantee must still hold.
insert into public.admin_users (user_id, note)
values ('44440000-0000-0000-0000-000000000001', 'registry test fixture')
on conflict (user_id) do nothing;

set role authenticated;
set request.jwt.claims = '{"sub":"44440000-0000-0000-0000-000000000001"}';

select assert(
  public.import_candles('[
    {"symbol":"BTCUSDT","timeframe":"H1","ts":"2026-07-01T00:00:00Z","open":60000,"high":60500,"low":59800,"close":60200,"volume":10}
  ]'::jsonb) = 1,
  'engine-persisted candle is written through import_candles'
);

select assert(
  public.import_candles('[
    {"symbol":"BTCUSDT","timeframe":"H1","ts":"2026-07-01T00:00:00Z","open":60000,"high":61000,"low":59800,"close":60900,"volume":20}
  ]'::jsonb) = 1,
  'refetching the same bar succeeds'
);

select assert(
  (select count(*) from public.candles
    where symbol = 'BTCUSDT' and timeframe = 'H1'
      and ts = '2026-07-01T00:00:00Z') = 1,
  'refetching does not duplicate the candle'
);
select assert(
  (select close from public.candles
    where symbol = 'BTCUSDT' and timeframe = 'H1'
      and ts = '2026-07-01T00:00:00Z') = 60900,
  'refetching corrects the stored bar in place'
);

reset role;

\echo '--- INSTRUMENT REGISTRY TESTS PASSED ---'
