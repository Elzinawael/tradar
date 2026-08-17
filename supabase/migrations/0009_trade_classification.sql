-- TRADAR — structured trade classification
--
-- Only TWO fields are genuinely missing. backtest_trades already carries
-- strategy_id, tags and notes (0004), and strategy ownership is already
-- validated by assert_owns_backtest_related(), so none of that is duplicated
-- here.
--
-- Naming: `market_session` is the trading period a trade occurred in (Asia,
-- London, New York…). It is deliberately NOT called "session", because
-- `backtest_sessions` already means the simulation container and conflating
-- the two would make the schema ambiguous.
--
-- Both columns are nullable text with no CHECK constraint on the value set.
-- Classification is optional — a trader should not be forced to grade every
-- trade — and a hard enum would mean a migration every time someone invents a
-- new setup grade. Length is bounded to keep the columns from being used as
-- free-form storage; the allowed value list is enforced in the server action,
-- where it can evolve without DDL.

alter table public.backtest_trades
  add column if not exists setup text;

alter table public.backtest_trades
  add column if not exists market_session text;

do $$ begin
  alter table public.backtest_trades
    add constraint backtest_trades_setup_length
    check (setup is null or length(setup) <= 40);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.backtest_trades
    add constraint backtest_trades_market_session_length
    check (market_session is null or length(market_session) <= 40);
exception when duplicate_object then null; end $$;

-- Grouping by these fields is the common analytics query, and both are
-- low-cardinality, so a composite index per session keeps the breakdown cheap.
create index if not exists backtest_trades_setup_idx
  on public.backtest_trades (session_id, setup);

create index if not exists backtest_trades_market_session_idx
  on public.backtest_trades (session_id, market_session);
