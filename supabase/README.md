# TRADAR — Supabase setup

Everything TRADAR needs from Supabase, and how to verify it works.

TRADAR runs in two modes. Without credentials it still builds, boots and
renders its empty states, so you can clone and run it with no backend.
With credentials, authentication and persistence come alive.

---

## 1. What you need to provide

Create a project at <https://supabase.com/dashboard>, then copy **two** values
from **Project Settings → API**:

| Value | Where it goes | Notes |
|---|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | e.g. `https://abcdefgh.supabase.co` |
| `anon` / publishable key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Safe in the browser — constrained by RLS |

Put them in **`.env.local`** at the repository root:

```bash
cp .env.example .env.local
# then edit .env.local and paste the two values
```

`.env.local` is already covered by `.gitignore`. Never commit it, and never
paste these values into a chat, issue or pull request.

> **Do not add the `service_role` key to this project.** It bypasses Row Level
> Security entirely. Nothing in TRADAR uses it, and placing it in a
> `NEXT_PUBLIC_*` variable would expose every user's data to the browser.

---

## 2. Apply the migrations

In the Supabase dashboard, open **SQL Editor** and run these files in order,
pasting the contents of each and executing:

1. `supabase/migrations/0001_init.sql` — tables, enums, constraints, indexes, triggers
2. `supabase/migrations/0002_rls.sql` — RLS policies, ownership guards, grants, signup provisioning
3. `supabase/migrations/0003_relax_force_rls.sql` — corrective migration (see below)

If you prefer the CLI and have it linked:

```bash
supabase db push
```

**`0003` is only needed if you applied an earlier version of `0002`** that set
`FORCE ROW LEVEL SECURITY`. It is safe to run regardless — it is idempotent and
harmless on a fresh project. It exists because `FORCE` subjects the *table
owner* to RLS, which blocks the `SECURITY DEFINER` signup trigger and makes
every signup fail unless the owning role holds `BYPASSRLS`. This was
reproduced against PostgreSQL 16; see `supabase/tests/`.

---

## 3. Auth settings

Under **Authentication → Providers**, Email is enabled by default and is all
TRADAR needs.

**Confirm email** decides the signup experience:

- **On** (default): signup creates the account but no session. TRADAR shows
  *"Check your inbox to confirm your email address, then log in."* Use this in
  production.
- **Off**: signup returns a session immediately and TRADAR redirects straight
  to the dashboard. Convenient for local development.

Both paths are handled in `lib/actions/auth.ts`.

---

## 4. What happens on signup

`0002_rls.sql` installs an `on_auth_user_created` trigger that provisions each
new user automatically:

- a `profiles` row (with `full_name` from the signup form)
- one `trading_accounts` row named **Primary Account**, marked default
- the five default discipline rules used by `/progress`

So a new user lands on a working dashboard with no manual setup. You will
probably want to set the account's starting balance — until then the equity
curve is seeded from zero.

---

## 5. Verify it works

Run the schema test suite against any PostgreSQL instance — **no Supabase
project required**:

```bash
PGHOST=/tmp/pgrun PGPORT=5433 npm run db:test
```

This creates a scratch database, applies all three migrations, and asserts:

- signup provisions a profile, a default account and five rules
- check constraints reject negative quantities, closed trades with no exit
  price, and exit times before entry times
- a user cannot attach a trade to another user's account, even by guessing
  the account's UUID
- **RLS isolation**: a signed-in user cannot read, update or delete another
  user's rows, and `anon` sees nothing at all
- journal and progress upserts update rather than duplicate
- deleting a strategy preserves trade history; deleting a user cascades

`supabase/tests/00_local_harness.sql` supplies the small part of Supabase's
platform surface the migrations depend on — the `auth` schema, `auth.uid()`
reading `request.jwt.claims`, and the `anon` / `authenticated` roles — so the
same SQL that runs in production runs locally. **It is a test fixture and must
never be run against a real Supabase project**, which already provides all of it.

### End-to-end check against your project

Once `.env.local` is set and the migrations are applied:

```bash
npm run dev
```

1. Visit `/signup` and create an account
2. Confirm your email if confirmation is enabled, then log in
3. `/dashboard` should load with your account in the top-left selector
4. Log a trade at `/trades/new` — set an exit price and exit time so it closes
5. `/trades` lists it; `/dashboard` and `/reports` should show non-zero metrics
6. `/journal`, `/strategies` and `/progress` should all save and reload

To confirm isolation, sign up a second account in a private window: it must see
none of the first account's trades.

---

## 6. Troubleshooting

| Symptom | Cause |
|---|---|
| `permission denied for table ...` | Migrations applied but grants missing — run `0003` |
| Signup succeeds, dashboard empty, no account in selector | Provisioning trigger blocked — run `0003` |
| `new row violates row-level security policy` | `FORCE ROW LEVEL SECURITY` still set — run `0003` |
| Auth screens say Supabase is not configured | `.env.local` missing or not picked up; restart the dev server |
| Logged in but redirected to `/login` | Cookies blocked, or the URL/anon key belong to different projects |
