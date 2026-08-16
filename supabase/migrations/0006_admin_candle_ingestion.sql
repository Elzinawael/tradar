-- TRADAR — admin-only candle ingestion
--
-- Candles stay shared reference data: every authenticated user reads them and
-- Replay is unchanged. What changes is who may WRITE them.
--
-- WHY A SEPARATE TABLE RATHER THAN A FLAG ON profiles
--
-- `profiles_update_own` (0002_rls.sql) allows a user to UPDATE their own
-- profile row, and PostgreSQL RLS policies cannot be scoped to individual
-- columns — a policy authorises the whole row. An `is_admin` column on
-- profiles would therefore be self-grantable: any user could PATCH
-- /rest/v1/profiles?id=eq.<self> with {"is_admin": true} and promote
-- themselves. Column-level GRANTs could patch that, but they are easy to undo
-- accidentally by a later `grant all`.
--
-- `admin_users` instead has NO write policy and NO write grant, so membership
-- cannot be changed through PostgREST by anyone, at any privilege level the
-- app possesses. It is managed only from the Supabase SQL editor:
--
--     insert into public.admin_users (user_id)
--     select id from auth.users where email = 'you@example.com';
--
-- Users may read their OWN row, which is how the UI knows whether to show the
-- import screen. That is a convenience, not the security boundary — the
-- boundary is import_candles() below.

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text not null default '',
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- Read-your-own-row only. No insert/update/delete policy exists, so those
-- operations are denied for every role that goes through PostgREST.
drop policy if exists "admin_users_select_self" on public.admin_users;
create policy "admin_users_select_self" on public.admin_users
  for select to authenticated using ((select auth.uid()) = user_id);

-- SELECT only. Deliberately no insert/update/delete grant.
grant select on public.admin_users to authenticated;

/**
 * True when the current request belongs to an administrator.
 *
 * SECURITY DEFINER so it can read admin_users regardless of the caller's RLS,
 * and STABLE so Postgres evaluates it once per statement.
 */
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
     where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- import_candles(): now admin-only
--
-- Replaces the 0005 definition. The authorisation check lives here, in the
-- database, so it holds even if a caller bypasses the application entirely and
-- calls the RPC directly with a valid user JWT.
-- ---------------------------------------------------------------------------
create or replace function public.import_candles(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.is_admin() then
    raise exception 'candle import is restricted to administrators';
  end if;

  if jsonb_typeof(payload) <> 'array' then
    raise exception 'payload must be a JSON array';
  end if;

  if jsonb_array_length(payload) > 5000 then
    raise exception 'at most 5000 candles per call';
  end if;

  with incoming as (
    select
      upper(btrim(c.symbol))    as symbol,
      c.timeframe,
      c.ts,
      c.open, c.high, c.low, c.close, c.volume
    from jsonb_to_recordset(payload) as c(
      symbol text, timeframe text, ts timestamptz,
      open numeric, high numeric, low numeric, close numeric, volume numeric
    )
  ),
  valid as (
    select * from incoming
    where symbol is not null and length(symbol) > 0
      and timeframe in ('M1','M5','M15','H1','H4','D1')
      and ts is not null
      and open > 0 and high > 0 and low > 0 and close > 0
      and high >= low
      and high >= open and high >= close
      and low <= open and low <= close
      and (volume is null or volume >= 0)
  ),
  upserted as (
    insert into public.candles (symbol, timeframe, ts, open, high, low, close, volume)
    select symbol, timeframe, ts, open, high, low, close, volume from valid
    on conflict (symbol, timeframe, ts) do update
      set open = excluded.open,
          high = excluded.high,
          low = excluded.low,
          close = excluded.close,
          volume = excluded.volume
    returning 1
  )
  select count(*)::integer into inserted from upserted;

  return coalesce(inserted, 0);
end;
$$;

revoke all on function public.import_candles(jsonb) from public;
grant execute on function public.import_candles(jsonb) to authenticated;
