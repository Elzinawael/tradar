-- TRADAR — initial schema
--
-- Mirrors the domain model already defined in lib/types.ts so the data access
-- layer can move from in-memory stubs to real queries without changing the UI.
--
-- Conventions:
--   * every user-owned table carries `user_id uuid references auth.users`
--   * timestamps are `timestamptz`
--   * monetary values are `numeric(18,2)`; prices `numeric(18,8)` to support
--     crypto/FX precision
--   * enums are Postgres enums to match the TypeScript union types

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums (mirror lib/types.ts unions)
-- ---------------------------------------------------------------------------
do $$ begin
  create type trade_direction as enum ('long', 'short');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trade_status as enum ('win', 'loss', 'breakeven', 'open');
exception when duplicate_object then null; end $$;

do $$ begin
  create type execution_side as enum ('buy', 'sell');
exception when duplicate_object then null; end $$;

do $$ begin
  create type backtest_status as enum ('draft', 'running', 'completed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — public mirror of auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  avatar_url  text,
  timezone    text        not null default 'UTC',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- trading_accounts
-- ---------------------------------------------------------------------------
create table if not exists public.trading_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  broker           text,
  currency         text not null default 'USD',
  starting_balance numeric(18,2) not null default 0,
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint trading_accounts_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists trading_accounts_user_id_idx
  on public.trading_accounts (user_id);

drop trigger if exists trading_accounts_set_updated_at on public.trading_accounts;
create trigger trading_accounts_set_updated_at
  before update on public.trading_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- strategies
-- ---------------------------------------------------------------------------
create table if not exists public.strategies (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  description text not null default '',
  market      text not null default '',
  timeframe   text not null default '',
  entry_rules text not null default '',
  exit_rules  text not null default '',
  risk_rules  text not null default '',
  checklist   text[] not null default '{}',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint strategies_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists strategies_user_id_idx on public.strategies (user_id);

drop trigger if exists strategies_set_updated_at on public.strategies;
create trigger strategies_set_updated_at
  before update on public.strategies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- trades
-- ---------------------------------------------------------------------------
create table if not exists public.trades (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  account_id       uuid not null references public.trading_accounts (id) on delete cascade,
  strategy_id      uuid references public.strategies (id) on delete set null,
  symbol           text not null,
  direction        trade_direction not null,
  entry_price      numeric(18,8) not null,
  exit_price       numeric(18,8),
  quantity         numeric(18,8) not null,
  pnl              numeric(18,2) not null default 0,
  fees             numeric(18,2) not null default 0,
  r_multiple       numeric(10,4),
  status           trade_status not null default 'open',
  opened_at        timestamptz not null,
  closed_at        timestamptz,
  duration_minutes integer,
  tags             text[] not null default '{}',
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint trades_symbol_not_blank check (length(btrim(symbol)) > 0),
  constraint trades_quantity_positive check (quantity > 0),
  constraint trades_entry_price_positive check (entry_price > 0),
  constraint trades_exit_price_positive check (exit_price is null or exit_price > 0),
  constraint trades_closed_after_opened check (closed_at is null or closed_at >= opened_at),
  -- a closed trade must have an exit price; an open trade must not be resolved
  constraint trades_closed_consistency check (
    (status = 'open' and closed_at is null)
    or (status <> 'open' and closed_at is not null and exit_price is not null)
  )
);

create index if not exists trades_user_id_idx on public.trades (user_id);
create index if not exists trades_account_id_idx on public.trades (account_id);
create index if not exists trades_strategy_id_idx on public.trades (strategy_id);
create index if not exists trades_user_opened_at_idx on public.trades (user_id, opened_at desc);
create index if not exists trades_symbol_idx on public.trades (user_id, symbol);
create index if not exists trades_tags_idx on public.trades using gin (tags);

drop trigger if exists trades_set_updated_at on public.trades;
create trigger trades_set_updated_at
  before update on public.trades
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- executions — individual fills belonging to a trade
-- ---------------------------------------------------------------------------
create table if not exists public.executions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  trade_id    uuid not null references public.trades (id) on delete cascade,
  side        execution_side not null,
  price       numeric(18,8) not null,
  quantity    numeric(18,8) not null,
  executed_at timestamptz not null,
  created_at  timestamptz not null default now(),
  constraint executions_price_positive check (price > 0),
  constraint executions_quantity_positive check (quantity > 0)
);

create index if not exists executions_trade_id_idx on public.executions (trade_id);
create index if not exists executions_user_id_idx on public.executions (user_id);

-- ---------------------------------------------------------------------------
-- journal_entries — one structured entry per trading day
-- ---------------------------------------------------------------------------
create table if not exists public.journal_entries (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  entry_date         date not null,
  pre_market_plan    text not null default '',
  session_notes      text not null default '',
  post_market_review text not null default '',
  lessons            text not null default '',
  mood               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, entry_date)
);

create index if not exists journal_entries_user_date_idx
  on public.journal_entries (user_id, entry_date desc);

drop trigger if exists journal_entries_set_updated_at on public.journal_entries;
create trigger journal_entries_set_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- backtest_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.backtest_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  strategy_id     uuid references public.strategies (id) on delete set null,
  name            text not null,
  symbol          text not null default '',
  timeframe       text not null default '',
  initial_balance numeric(18,2) not null default 0,
  risk_per_trade  numeric(10,4) not null default 0,
  status          backtest_status not null default 'draft',
  net_pnl         numeric(18,2),
  trade_count     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint backtest_sessions_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists backtest_sessions_user_id_idx
  on public.backtest_sessions (user_id);

drop trigger if exists backtest_sessions_set_updated_at on public.backtest_sessions;
create trigger backtest_sessions_set_updated_at
  before update on public.backtest_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- progress_rules + progress_completions — discipline tracking
-- ---------------------------------------------------------------------------
create table if not exists public.progress_rules (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  label      text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_rules_label_not_blank check (length(btrim(label)) > 0)
);

create index if not exists progress_rules_user_id_idx on public.progress_rules (user_id);

drop trigger if exists progress_rules_set_updated_at on public.progress_rules;
create trigger progress_rules_set_updated_at
  before update on public.progress_rules
  for each row execute function public.set_updated_at();

create table if not exists public.progress_completions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  rule_id        uuid not null references public.progress_rules (id) on delete cascade,
  completion_date date not null,
  completed      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (rule_id, completion_date)
);

create index if not exists progress_completions_user_date_idx
  on public.progress_completions (user_id, completion_date desc);

drop trigger if exists progress_completions_set_updated_at on public.progress_completions;
create trigger progress_completions_set_updated_at
  before update on public.progress_completions
  for each row execute function public.set_updated_at();
