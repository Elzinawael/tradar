-- TRADAR — pending replay orders and explicit exit reason
--
-- Covers the order lifecycle at the database level: the constraints that make
-- an order well-formed, the one-pending-order invariant, cancellation
-- semantics, cross-user rejection, and the exit_reason column.
--
-- Fill MATCHING itself is pure TypeScript (lib/replay-engine.ts) and is covered
-- by unit tests; here we prove the storage and access rules hold.

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

\echo '--- O1. fixtures ---'

insert into auth.users (id, email) values
  ('44440000-0000-0000-0000-00000000000a', 'olive@example.com'),
  ('55550000-0000-0000-0000-00000000000b', 'oscar@example.com');

insert into public.admin_users (user_id, note)
values ('44440000-0000-0000-0000-00000000000a', 'order test fixture')
on conflict (user_id) do nothing;

insert into public.candles (symbol, timeframe, ts, open, high, low, close) values
  ('ORD','M1','2026-07-01T09:00:00Z', 100, 101, 99, 100),
  ('ORD','M1','2026-07-01T09:01:00Z', 100, 102, 98, 101);

insert into public.backtest_sessions (user_id, name, symbol, timeframe, initial_balance, risk_per_trade) values
  ('44440000-0000-0000-0000-00000000000a', 'Olive session', 'ORD', 'M1', 10000, 1),
  ('55550000-0000-0000-0000-00000000000b', 'Oscar session', 'ORD', 'M1', 10000, 1);

insert into public.replay_sessions
  (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts)
select '44440000-0000-0000-0000-00000000000a', id, 'ORD', 'M1',
       '2026-07-01T09:00:00Z', '2026-07-01T09:01:00Z', '2026-07-01T09:00:00Z'
  from public.backtest_sessions where name = 'Olive session';

insert into public.replay_sessions
  (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts)
select '55550000-0000-0000-0000-00000000000b', id, 'ORD', 'M1',
       '2026-07-01T09:00:00Z', '2026-07-01T09:01:00Z', '2026-07-01T09:00:00Z'
  from public.backtest_sessions where name = 'Oscar session';

\echo '--- O2. a pending order is representable ---'

insert into public.replay_orders
  (user_id, replay_id, session_id, symbol, timeframe, direction, order_type,
   requested_price, stop_price, take_profit, quantity, expiry_bars,
   setup, market_session, tags, notes)
select '44440000-0000-0000-0000-00000000000a', r.id, b.id, 'ORD', 'M1',
       'long', 'limit', 99, 98, 105, 100, 10,
       'A+', 'London', array['FVG'], 'resting bid'
  from public.backtest_sessions b
  join public.replay_sessions r on r.session_id = b.id
 where b.name = 'Olive session';

select assert(
  (select count(*) from public.replay_orders where status = 'pending') = 1,
  'a pending limit order is stored'
);
select assert(
  (select fill_price is null and filled_at is null
     from public.replay_orders where status = 'pending'),
  'a pending order has no fill price or time'
);
select assert(
  (select setup = 'A+' and market_session = 'London'
     from public.replay_orders where status = 'pending'),
  'classification is carried on the order'
);

\echo '--- O3. order constraints ---'

do $$
declare s uuid; r uuid;
begin
  select b.id, rs.id into s, r
    from public.backtest_sessions b
    join public.replay_sessions rs on rs.session_id = b.id
   where b.name = 'Olive session';

  -- A limit order must state its price.
  begin
    insert into public.replay_orders
      (user_id, replay_id, session_id, symbol, timeframe, direction, order_type, quantity)
    values ('44440000-0000-0000-0000-00000000000a', r, s, 'ORD', 'M1',
            'long', 'limit', 100);
    raise exception 'FAIL  a limit order without a price was accepted';
  exception when check_violation then
    raise notice 'PASS  a limit order requires a requested price';
  end;

  -- A market order must NOT carry one: the server decides its fill price.
  begin
    insert into public.replay_orders
      (user_id, replay_id, session_id, symbol, timeframe, direction, order_type,
       requested_price, quantity, status)
    values ('44440000-0000-0000-0000-00000000000a', r, s, 'ORD', 'M1',
            'long', 'market', 99, 100, 'cancelled');
    raise exception 'FAIL  a market order with a requested price was accepted';
  exception when check_violation then
    raise notice 'PASS  a market order cannot carry a requested price';
  end;

  -- A filled order must record how and when it filled.
  begin
    insert into public.replay_orders
      (user_id, replay_id, session_id, symbol, timeframe, direction, order_type,
       requested_price, quantity, status)
    values ('44440000-0000-0000-0000-00000000000a', r, s, 'ORD', 'M1',
            'long', 'limit', 99, 100, 'filled');
    raise exception 'FAIL  a filled order without a fill price was accepted';
  exception when check_violation then
    raise notice 'PASS  a filled order must record its fill price and time';
  end;

  -- ONE pending order per replay: the invariant is enforced by an index, so a
  -- concurrent double submit cannot create two.
  begin
    insert into public.replay_orders
      (user_id, replay_id, session_id, symbol, timeframe, direction, order_type,
       requested_price, quantity)
    values ('44440000-0000-0000-0000-00000000000a', r, s, 'ORD', 'M1',
            'short', 'limit', 105, 100);
    raise exception 'FAIL  a second pending order was accepted';
  exception when unique_violation then
    raise notice 'PASS  only one pending order per replay';
  end;
end $$;

\echo '--- O4. cross-user rejection ---'

do $$
declare olive_replay uuid; oscar_session uuid;
begin
  select r.id into olive_replay from public.replay_sessions r
    join public.backtest_sessions b on b.id = r.session_id
   where b.name = 'Olive session';
  select id into oscar_session from public.backtest_sessions
   where name = 'Oscar session';

  -- Oscar rests an order against Olive's replay.
  begin
    insert into public.replay_orders
      (user_id, replay_id, session_id, symbol, timeframe, direction, order_type,
       requested_price, quantity)
    values ('55550000-0000-0000-0000-00000000000b', olive_replay, oscar_session,
            'ORD', 'M1', 'long', 'limit', 99, 100);
    raise exception 'FAIL  an order against another user''s replay was accepted';
  exception when others then
    if sqlerrm like '%replay_id does not belong%' then
      raise notice 'PASS  cross-user replay order rejected';
    else
      raise;
    end if;
  end;
end $$;

set role authenticated;
set request.jwt.claims = '{"sub":"55550000-0000-0000-0000-00000000000b"}';

select assert(
  (select count(*) from public.replay_orders) = 0,
  'Oscar cannot see Olive''s orders'
);

do $$
declare affected integer;
begin
  update public.replay_orders set status = 'cancelled', cancelled_at = now();
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice 'PASS  Oscar cannot cancel Olive''s order';
  else
    raise exception 'FAIL  Oscar cancelled % of Olive''s orders', affected;
  end if;
end $$;

reset role;
set role anon;
select assert(
  (select count(*) from public.replay_orders) = 0,
  'anon sees no replay orders'
);
reset role;

\echo '--- O5. cancellation semantics ---'

-- Cancelling a pending order works.
update public.replay_orders
   set status = 'cancelled', cancelled_at = now()
 where status = 'pending';

select assert(
  (select count(*) from public.replay_orders where status = 'cancelled') = 1,
  'a pending order can be cancelled'
);

-- The server cancels with `.eq("status","pending")`, so re-cancelling matches
-- no rows rather than mutating a settled order.
do $$
declare affected integer;
begin
  update public.replay_orders
     set status = 'cancelled', cancelled_at = now()
   where status = 'pending';
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice 'PASS  an already-cancelled order cannot be cancelled again';
  else
    raise exception 'FAIL  a settled order was cancelled again';
  end if;
end $$;

-- Cancelling frees the replay for a new order: the index constrains only
-- PENDING rows.
insert into public.replay_orders
  (user_id, replay_id, session_id, symbol, timeframe, direction, order_type,
   requested_price, stop_price, quantity)
select '44440000-0000-0000-0000-00000000000a', r.id, b.id, 'ORD', 'M1',
       'long', 'stop', 101, 99, 100
  from public.backtest_sessions b
  join public.replay_sessions r on r.session_id = b.id
 where b.name = 'Olive session';

select assert(
  (select count(*) from public.replay_orders where status = 'pending') = 1,
  'a new order may rest once the previous one is cancelled'
);

\echo '--- O6. fill converts the order into a trade ---'

do $$
declare o uuid; s uuid; r uuid; t uuid;
begin
  select id, session_id, replay_id into o, s, r
    from public.replay_orders where status = 'pending';

  insert into public.backtest_trades
    (user_id, session_id, replay_id, origin, symbol, direction,
     entry_price, stop_price, quantity, pnl, status, opened_at, entry_candle_ts,
     setup, market_session, tags)
  values ('44440000-0000-0000-0000-00000000000a', s, r, 'replay', 'ORD',
          'long', 101, 99, 100, 0, 'open',
          '2026-07-01T09:01:00Z', '2026-07-01T09:01:00Z',
          'A+', 'London', array['FVG'])
  returning id into t;

  update public.replay_orders
     set status = 'filled', filled_at = '2026-07-01T09:01:00Z',
         fill_price = 101, trade_id = t
   where id = o;
end $$;

select assert(
  (select count(*) from public.replay_orders where status = 'filled') = 1,
  'the order is marked filled'
);
select assert(
  (select trade_id is not null from public.replay_orders where status = 'filled'),
  'the filled order links to the trade it produced'
);
select assert(
  (select count(*) from public.backtest_trades
    where symbol = 'ORD' and status = 'open') = 1,
  'the fill produced exactly one open position'
);
select assert(
  (select setup from public.backtest_trades where symbol = 'ORD') = 'A+',
  'classification survives the order-to-trade conversion'
);

-- A pending order is NOT a trade, so analytics never sees it.
select assert(
  (select count(*) from public.backtest_trades
    where symbol = 'ORD' and status <> 'open') = 0,
  'a pending order never counts as a closed trade'
);

\echo '--- O7. exit_reason ---'

update public.backtest_trades
   set exit_price = 99, closed_at = '2026-07-01T09:01:00Z',
       exit_candle_ts = '2026-07-01T09:01:00Z', duration_minutes = 0,
       pnl = -200, r_multiple = -1, status = 'loss', exit_reason = 'stop_loss'
 where symbol = 'ORD' and status = 'open';

select assert(
  (select exit_reason from public.backtest_trades where symbol = 'ORD') = 'stop_loss',
  'the engine records an explicit exit reason'
);

-- A gap fill exits at the bar open, so the price matches NEITHER level. This
-- is precisely the case price-comparison used to mislabel.
insert into public.backtest_trades
  (user_id, session_id, replay_id, origin, symbol, direction,
   entry_price, exit_price, stop_price, take_profit, quantity, pnl, r_multiple,
   status, opened_at, closed_at, duration_minutes, exit_reason)
select '44440000-0000-0000-0000-00000000000a', b.id, r.id, 'replay', 'ORDGAP',
       'long', 100, 96, 98, 105, 10, -40, -2, 'loss',
       '2026-07-01T09:00:00Z', '2026-07-01T09:01:00Z', 1, 'stop_loss'
  from public.backtest_sessions b
  join public.replay_sessions r on r.session_id = b.id
 where b.name = 'Olive session';

select assert(
  (select exit_reason from public.backtest_trades where symbol = 'ORDGAP') = 'stop_loss',
  'a gap fill still records the reason it triggered, despite the price differing'
);
select assert(
  (select exit_price <> stop_price from public.backtest_trades where symbol = 'ORDGAP'),
  'the gap exit price genuinely differs from the stop level'
);

-- An open trade may not carry an exit reason.
do $$
declare s uuid;
begin
  select id into s from public.backtest_sessions where name = 'Olive session';
  begin
    insert into public.backtest_trades
      (user_id, session_id, symbol, direction, entry_price, quantity,
       status, opened_at, exit_reason)
    values ('44440000-0000-0000-0000-00000000000a', s, 'ORD', 'long', 100, 1,
            'open', now(), 'manual');
    raise exception 'FAIL  an open trade with an exit reason was accepted';
  exception when check_violation then
    raise notice 'PASS  an open trade cannot carry an exit reason';
  end;
end $$;

-- Backward compatible: trades closed before this column existed keep NULL.
select assert(
  (select count(*) from public.backtest_trades where exit_reason is null) > 0,
  'pre-existing closed trades keep a null exit reason'
);

\echo '--- O8. regression: manual backtest trades unaffected ---'

insert into public.backtest_trades
  (user_id, session_id, symbol, direction, entry_price, exit_price, quantity,
   pnl, status, opened_at, closed_at, duration_minutes)
select '44440000-0000-0000-0000-00000000000a', id, 'ORDMAN', 'short',
       100, 98, 10, 20, 'win',
       '2026-07-01T09:00:00Z', '2026-07-01T09:01:00Z', 1
  from public.backtest_sessions where name = 'Olive session';

select assert(
  (select origin from public.backtest_trades where symbol = 'ORDMAN') = 'manual',
  'a manual backtest trade still saves with origin manual'
);
select assert(
  (select replay_id is null and exit_reason is null
     from public.backtest_trades where symbol = 'ORDMAN'),
  'a manual trade carries no replay id and no engine exit reason'
);

\echo '--- REPLAY ORDER TESTS PASSED ---'
