-- TRADAR — local Supabase compatibility harness (TEST ONLY)
--
-- This file is NOT part of the production migrations and must never be run
-- against a real Supabase project — Supabase already provides everything
-- defined here.
--
-- It recreates the minimum of Supabase's platform surface that the TRADAR
-- migrations depend on, so `0001_init.sql` and `0002_rls.sql` can be applied
-- and exercised against a plain PostgreSQL instance:
--
--   * the `auth` schema and `auth.users` table (referenced by every FK)
--   * `auth.uid()` reading the current request's JWT claims
--   * the `anon` / `authenticated` / `service_role` roles
--
-- Supabase derives auth.uid() from `request.jwt.claims`, a per-transaction
-- GUC set by PostgREST. The implementation below reads the same GUC, so
-- switching the "current user" in a test is done exactly the way PostgREST
-- does it in production:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid>"}';

create schema if not exists auth;

-- Roles PostgREST connects as.
do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;

do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;

do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;

-- Minimal auth.users. Only the columns TRADAR actually reads are modelled:
-- `id` (referenced by every user_id FK) and `raw_user_meta_data` (read by
-- handle_new_user to pull full_name off the signup payload).
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

/**
 * Mirrors Supabase's auth.uid().
 * Returns the `sub` claim of the current request's JWT, or null when
 * unauthenticated.
 */
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants table privileges to BOTH anon and authenticated; RLS is what
-- actually constrains rows. Modelling the anon grant matters: it proves the
-- anon role is denied by policy (zero rows) rather than merely by a missing
-- GRANT, which is the weaker guarantee.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
