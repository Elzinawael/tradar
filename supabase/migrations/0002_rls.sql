-- TRADAR — Row Level Security
--
-- Every table is owner-scoped: a row is visible and writable only by the user
-- whose id is in `user_id` (or `id` for profiles). RLS is FORCED so that even
-- the table owner cannot bypass it accidentally.
--
-- The anon/authenticated roles reach these tables only through PostgREST, so
-- these policies are the single authorization boundary for client access.

-- ---------------------------------------------------------------------------
-- Enable + force RLS
-- ---------------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.trading_accounts      enable row level security;
alter table public.strategies            enable row level security;
alter table public.trades                enable row level security;
alter table public.executions            enable row level security;
alter table public.journal_entries       enable row level security;
alter table public.backtest_sessions     enable row level security;
alter table public.progress_rules        enable row level security;
alter table public.progress_completions  enable row level security;

alter table public.profiles              force row level security;
alter table public.trading_accounts      force row level security;
alter table public.strategies            force row level security;
alter table public.trades                force row level security;
alter table public.executions            force row level security;
alter table public.journal_entries       force row level security;
alter table public.backtest_sessions     force row level security;
alter table public.progress_rules        force row level security;
alter table public.progress_completions  force row level security;

-- ---------------------------------------------------------------------------
-- profiles — keyed on id rather than user_id
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated using ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- Owner-scoped policies for the remaining tables.
--
-- `(select auth.uid())` is used rather than a bare `auth.uid()` so Postgres
-- evaluates it once per statement (InitPlan) instead of once per row — a
-- significant difference on large trade tables.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  owner_tables text[] := array[
    'trading_accounts',
    'strategies',
    'trades',
    'executions',
    'journal_entries',
    'backtest_sessions',
    'progress_rules',
    'progress_completions'
  ];
begin
  foreach t in array owner_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Referential guards
--
-- RLS alone would let a user attach a trade to another user's account if they
-- guessed the uuid, because the row's own user_id would still be their own.
-- These triggers verify cross-table ownership.
-- ---------------------------------------------------------------------------
create or replace function public.assert_owns_related()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  if tg_table_name = 'trades' then
    select user_id into owner from public.trading_accounts where id = new.account_id;
    if owner is null or owner <> new.user_id then
      raise exception 'account_id does not belong to the current user';
    end if;

    if new.strategy_id is not null then
      select user_id into owner from public.strategies where id = new.strategy_id;
      if owner is null or owner <> new.user_id then
        raise exception 'strategy_id does not belong to the current user';
      end if;
    end if;

  elsif tg_table_name = 'executions' then
    select user_id into owner from public.trades where id = new.trade_id;
    if owner is null or owner <> new.user_id then
      raise exception 'trade_id does not belong to the current user';
    end if;

  elsif tg_table_name = 'progress_completions' then
    select user_id into owner from public.progress_rules where id = new.rule_id;
    if owner is null or owner <> new.user_id then
      raise exception 'rule_id does not belong to the current user';
    end if;

  elsif tg_table_name = 'backtest_sessions' then
    if new.strategy_id is not null then
      select user_id into owner from public.strategies where id = new.strategy_id;
      if owner is null or owner <> new.user_id then
        raise exception 'strategy_id does not belong to the current user';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trades_assert_owns_related on public.trades;
create trigger trades_assert_owns_related
  before insert or update on public.trades
  for each row execute function public.assert_owns_related();

drop trigger if exists executions_assert_owns_related on public.executions;
create trigger executions_assert_owns_related
  before insert or update on public.executions
  for each row execute function public.assert_owns_related();

drop trigger if exists progress_completions_assert_owns_related on public.progress_completions;
create trigger progress_completions_assert_owns_related
  before insert or update on public.progress_completions
  for each row execute function public.assert_owns_related();

drop trigger if exists backtest_sessions_assert_owns_related on public.backtest_sessions;
create trigger backtest_sessions_assert_owns_related
  before insert or update on public.backtest_sessions
  for each row execute function public.assert_owns_related();

-- ---------------------------------------------------------------------------
-- New-user provisioning
--
-- On signup, create the profile, a default trading account, and the default
-- discipline rules that lib/data.ts previously hard-coded.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  labels text[] := array[
    'Follow risk management',
    'No revenge trading',
    'Follow strategy',
    'Respect daily loss limit',
    'Complete post-market review'
  ];
  i integer;
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  insert into public.trading_accounts (user_id, name, currency, starting_balance, is_default)
  values (new.id, 'Primary Account', 'USD', 0, true);

  for i in 1 .. array_length(labels, 1) loop
    insert into public.progress_rules (user_id, label, sort_order)
    values (new.id, labels[i], i);
  end loop;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
