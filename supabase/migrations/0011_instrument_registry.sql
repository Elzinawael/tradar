-- TRADAR — Phase 5: instrument registry and provider listings
--
-- WHAT IS DELIBERATELY NOT CHANGED
--
-- public.candles already stores normalised OHLC keyed by
-- (symbol, timeframe, ts). That composite primary key IS the canonical candle
-- identity, and it already makes imports idempotent: re-importing an
-- overlapping range updates rows instead of duplicating them. Phase 5 adds no
-- column to it and does not re-key it, so every existing replay, backtest and
-- CSV import keeps working untouched.
--
-- WHAT IS ADDED
--
-- 1. instruments          — the catalogue of markets Tradar can support
-- 2. instrument_providers — how each provider names that instrument
--
-- The separation matters: a Tradar symbol is stable and customer-facing
-- (XAUUSD), while a provider's identifier for the same thing is not
-- (XAU/USD, XAUUSD, C:XAUUSD, an integer id…). Storing the mapping means
-- adding a provider later is data, not a schema change or a code change in
-- Replay.
--
-- An instrument existing in the registry means "Tradar can represent this
-- market". Whether data can actually be fetched depends on whether a
-- configured provider lists it — those are two different questions and the
-- schema keeps them apart on purpose.

-- ---------------------------------------------------------------------------
-- Market categories
--
-- Postgres enum rather than free text: this set is small, product-defining and
-- drives UI grouping, so a typo should fail loudly rather than create a ghost
-- category nothing renders under.
-- ---------------------------------------------------------------------------
do $$ begin
  create type market_category as enum (
    'forex', 'commodities', 'indices', 'stocks', 'futures', 'crypto', 'options'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- instruments
--
-- Shared reference data, exactly like public.candles: every signed-in user
-- reads the same catalogue. It is not user-owned, so the owner-scoped RLS
-- pattern used for trades does not apply here.
-- ---------------------------------------------------------------------------
create table if not exists public.instruments (
  id                 uuid primary key default gen_random_uuid(),
  -- The Tradar symbol. Stable, customer-facing, and the key candles are
  -- stored under.
  symbol             text not null unique,
  display_name       text not null,
  category           market_category not null,
  asset_type         text,
  base_asset         text,
  quote_asset        text,
  exchange           text,
  -- IANA zone the instrument's session is defined in. Session boundaries are
  -- local to a venue, not to the viewer.
  timezone           text not null default 'UTC',
  price_precision    smallint not null default 2,
  quantity_precision smallint not null default 8,
  active             boolean not null default true,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint instruments_symbol_not_blank check (length(btrim(symbol)) > 0),
  constraint instruments_display_name_not_blank check (length(btrim(display_name)) > 0),
  constraint instruments_price_precision_sane check (price_precision between 0 and 12),
  constraint instruments_quantity_precision_sane check (quantity_precision between 0 and 12)
);

create index if not exists instruments_category_idx
  on public.instruments (category) where active;

-- Case-insensitive prefix/substring search on the symbol and display name is
-- the main catalogue query, so both are indexed for pattern matching.
create index if not exists instruments_symbol_search_idx
  on public.instruments (lower(symbol) text_pattern_ops);
create index if not exists instruments_name_search_idx
  on public.instruments (lower(display_name) text_pattern_ops);

drop trigger if exists instruments_set_updated_at on public.instruments;
create trigger instruments_set_updated_at
  before update on public.instruments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- instrument_providers
--
-- One row per (instrument, provider). Declares the provider's own symbol and
-- what it can actually serve. `priority` breaks ties when several providers
-- list the same instrument — lower wins.
-- ---------------------------------------------------------------------------
create table if not exists public.instrument_providers (
  id                  uuid primary key default gen_random_uuid(),
  instrument_id       uuid not null references public.instruments (id) on delete cascade,
  -- Matches a provider key implemented in lib/market-data/providers/*.
  -- Deliberately text, not an enum: adding a provider should be a row, not a
  -- migration.
  provider            text not null,
  provider_symbol     text not null,
  supports_historical  boolean not null default true,
  supports_realtime    boolean not null default false,
  -- Timeframes this provider serves for this instrument. Empty means "the
  -- provider's own default set", which the adapter declares in code.
  timeframes          text[] not null default '{}',
  priority            smallint not null default 100,
  active              boolean not null default true,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (instrument_id, provider),
  constraint instrument_providers_provider_not_blank check (length(btrim(provider)) > 0),
  constraint instrument_providers_symbol_not_blank check (length(btrim(provider_symbol)) > 0)
);

create index if not exists instrument_providers_instrument_idx
  on public.instrument_providers (instrument_id) where active;

drop trigger if exists instrument_providers_set_updated_at on public.instrument_providers;
create trigger instrument_providers_set_updated_at
  before update on public.instrument_providers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Read for any signed-in user; no write policy at all. The catalogue and its
-- provider routing are operator-controlled — a customer must not be able to
-- add an instrument, repoint a provider symbol, or change routing priority.
-- Writes happen from the SQL editor or an admin path, never through PostgREST.
-- ---------------------------------------------------------------------------
alter table public.instruments enable row level security;
alter table public.instrument_providers enable row level security;

drop policy if exists "instruments_read" on public.instruments;
create policy "instruments_read" on public.instruments
  for select to authenticated using (true);

drop policy if exists "instrument_providers_read" on public.instrument_providers;
create policy "instrument_providers_read" on public.instrument_providers
  for select to authenticated using (true);

grant select on public.instruments to authenticated;
grant select on public.instrument_providers to authenticated;

-- ---------------------------------------------------------------------------
-- Seed catalogue
--
-- Represents what Tradar CAN model, not what is currently fetchable. Only the
-- crypto rows get a provider listing below, because Binance is the only
-- adapter with credentials-free access today. Everything else is deliberately
-- listed with NO provider, so the UI reports "no data source configured"
-- rather than implying a feed that does not exist.
-- ---------------------------------------------------------------------------
insert into public.instruments
  (symbol, display_name, category, asset_type, base_asset, quote_asset, exchange, timezone, price_precision)
values
  ('EURUSD', 'Euro / US Dollar',        'forex',       'spot',   'EUR', 'USD', null,      'UTC', 5),
  ('GBPUSD', 'British Pound / US Dollar','forex',      'spot',   'GBP', 'USD', null,      'UTC', 5),
  ('USDJPY', 'US Dollar / Japanese Yen','forex',       'spot',   'USD', 'JPY', null,      'UTC', 3),
  ('AUDUSD', 'Australian Dollar / US Dollar','forex',  'spot',   'AUD', 'USD', null,      'UTC', 5),
  ('XAUUSD', 'Gold / US Dollar',        'commodities', 'spot',   'XAU', 'USD', null,      'UTC', 2),
  ('XAGUSD', 'Silver / US Dollar',      'commodities', 'spot',   'XAG', 'USD', null,      'UTC', 3),
  ('WTIUSD', 'Crude Oil WTI / US Dollar','commodities','spot',   'WTI', 'USD', null,      'UTC', 2),
  ('SPX500', 'S&P 500 Index',           'indices',     'index',  null,  'USD', null,      'America/New_York', 2),
  ('NAS100', 'Nasdaq 100 Index',        'indices',     'index',  null,  'USD', null,      'America/New_York', 2),
  ('GER40',  'DAX 40 Index',            'indices',     'index',  null,  'EUR', null,      'Europe/Berlin', 2),
  ('AAPL',   'Apple Inc.',              'stocks',      'equity', null,  'USD', 'NASDAQ',  'America/New_York', 2),
  ('MSFT',   'Microsoft Corporation',   'stocks',      'equity', null,  'USD', 'NASDAQ',  'America/New_York', 2),
  ('TSLA',   'Tesla, Inc.',             'stocks',      'equity', null,  'USD', 'NASDAQ',  'America/New_York', 2),
  ('ES',     'E-mini S&P 500 Futures',  'futures',     'future', null,  'USD', 'CME',     'America/Chicago', 2),
  ('NQ',     'E-mini Nasdaq-100 Futures','futures',    'future', null,  'USD', 'CME',     'America/Chicago', 2),
  ('BTCUSDT','Bitcoin / Tether',        'crypto',      'spot',   'BTC', 'USDT','Binance', 'UTC', 2),
  ('ETHUSDT','Ethereum / Tether',       'crypto',      'spot',   'ETH', 'USDT','Binance', 'UTC', 2),
  ('SOLUSDT','Solana / Tether',         'crypto',      'spot',   'SOL', 'USDT','Binance', 'UTC', 2)
on conflict (symbol) do nothing;

-- Only Binance is listed, because only Binance has a working credential-free
-- adapter. Adding another provider later is an INSERT here plus an adapter
-- file — no change to Replay, Backtesting or this schema.
insert into public.instrument_providers
  (instrument_id, provider, provider_symbol, supports_historical, supports_realtime, timeframes, priority)
select i.id, 'binance', i.symbol, true, false,
       array['M1','M5','M15','H1','H4','D1'], 10
  from public.instruments i
 where i.category = 'crypto'
on conflict (instrument_id, provider) do nothing;
