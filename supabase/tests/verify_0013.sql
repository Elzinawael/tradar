-- Run in the Supabase dashboard SQL Editor AFTER applying
-- supabase/migrations/0013_market_data_coverage.sql
--
-- Read-only. Every row should report 'OK'.

with checks as (
  select 'table candle_coverage' as object,
         to_regclass('public.candle_coverage') is not null as present
  union all
  select 'table market_data_ingest_log',
         to_regclass('public.market_data_ingest_log') is not null
  union all
  select 'function ingest_market_data',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ingest_market_data')
  union all
  select 'function record_candle_coverage',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'record_candle_coverage')
  union all
  select 'replay_sessions.dataset_bars',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'replay_sessions'
                   and column_name = 'dataset_bars')
  union all
  select 'replay_sessions.dataset_first_ts',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'replay_sessions'
                   and column_name = 'dataset_first_ts')
  union all
  select 'replay_sessions.dataset_last_ts',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'replay_sessions'
                   and column_name = 'dataset_last_ts')
  union all
  select 'RLS on candle_coverage',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.candle_coverage')), false)
  union all
  select 'RLS on market_data_ingest_log',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.market_data_ingest_log')), false)
  union all
  select 'import_candles still present (0006 untouched)',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'import_candles')
)
select object, case when present then 'OK' else 'MISSING' end as status
from checks order by object;

-- Instruments required for Replay
select symbol, active, price_precision
from public.instruments
where symbol in ('EURUSD', 'XAUUSD', 'BTCUSDT')
order by symbol;

-- No write policy / no write grant on the new tables (SECURITY DEFINER only)
select tablename, policyname, cmd, roles
from pg_policies
where tablename in ('candle_coverage', 'market_data_ingest_log')
order by tablename, policyname;
