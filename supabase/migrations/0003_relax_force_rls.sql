-- TRADAR — remove FORCE ROW LEVEL SECURITY
--
-- Corrective migration for projects that already applied an earlier version of
-- 0002_rls.sql, which enabled FORCE ROW LEVEL SECURITY on every table.
--
-- Why this is required:
--   FORCE subjects the table OWNER to RLS. `public.handle_new_user()` is a
--   SECURITY DEFINER trigger on auth.users that provisions each new user's
--   profile, default trading account and discipline rules. Running as the
--   owner under FORCE, those inserts fail with
--     "new row violates row-level security policy"
--   unless the owning role holds BYPASSRLS. The practical effect is that
--   signup fails for every new user.
--
-- Security impact: none for application access paths. RLS remains ENABLED and
-- every policy is unchanged, so `anon` and `authenticated` — the only roles
-- PostgREST connects as — are still fully constrained.
--
-- Safe to run more than once, and safe on a project that never had FORCE set.

alter table public.profiles              no force row level security;
alter table public.trading_accounts      no force row level security;
alter table public.strategies            no force row level security;
alter table public.trades                no force row level security;
alter table public.executions            no force row level security;
alter table public.journal_entries       no force row level security;
alter table public.backtest_sessions     no force row level security;
alter table public.progress_rules        no force row level security;
alter table public.progress_completions  no force row level security;


-- ---------------------------------------------------------------------------
-- Table privileges
--
-- RLS decides WHICH ROWS a role may touch; it does not grant access to the
-- table in the first place. Supabase normally supplies these grants through
-- default privileges configured for the `postgres` role, but that is implicit
-- and depends on which role runs the migration — if the tables end up owned by
-- another role, PostgREST fails with "permission denied for table" even though
-- the policies are correct. Granting explicitly makes the schema
-- self-contained and idempotent.
--
-- `authenticated` gets full DML; every statement is still filtered by the
-- policies above. `anon` gets SELECT only, and since no policy targets the
-- anon role it resolves to zero rows — verified in supabase/tests/01_smoke.sql.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on
  public.profiles,
  public.trading_accounts,
  public.strategies,
  public.trades,
  public.executions,
  public.journal_entries,
  public.backtest_sessions,
  public.progress_rules,
  public.progress_completions
to authenticated;

grant select on
  public.profiles,
  public.trading_accounts,
  public.strategies,
  public.trades,
  public.executions,
  public.journal_entries,
  public.backtest_sessions,
  public.progress_rules,
  public.progress_completions
to anon;
