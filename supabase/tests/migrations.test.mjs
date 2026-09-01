/**
 * Migration + database-function tests, run against pglite (an in-process WASM
 * PostgreSQL). No Docker, no psql, no Supabase project — so this runs anywhere
 * `npm test` runs.
 *
 * It does NOT replace supabase/tests/*.sql (the pgTAP RLS suite, which needs a
 * real server): it covers the schema, the SECURITY DEFINER functions and their
 * authorization/rate-limit behaviour that this codebase relies on.
 *
 *   node --test supabase/tests/migrations.test.mjs
 */
import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

let PGlite
try {
  ;({ PGlite } = await import("@electric-sql/pglite"))
} catch {
  console.log("SKIP: @electric-sql/pglite not installed")
  process.exit(0)
}

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")

const MIGRATIONS = [
  "0001_init", "0002_rls", "0003_relax_force_rls", "0004_backtest_trades",
  "0005_candles_and_replay", "0006_admin_candle_ingestion",
  "0007_replay_ownership_guard", "0008_one_open_replay_position",
  "0009_trade_classification", "0010_replay_orders", "0011_instrument_registry",
  "0012_provider_listings", "0013_market_data_coverage",
]

/** pglite ships gen_random_uuid() in core; the pgcrypto extension is absent. */
const sanitize = (sql) =>
  sql.replace(/create extension if not exists\s+"?pgcrypto"?\s*;/gi, "-- pgcrypto (core in pglite)")

let db
const USER_A = "11111111-1111-1111-1111-111111111111"
const USER_B = "22222222-2222-2222-2222-222222222222"

/** Run `fn` authenticated as `uid`, ISOLATED — everything rolls back after. */
async function asUser(uid, fn) {
  await db.exec("begin")
  await db.exec(`set local role authenticated`)
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ sub: uid })}'`)
  try {
    return await fn()
  } finally {
    await db.exec("rollback").catch(() => db.exec("rollback"))
  }
}

/** Run `fn` authenticated as `uid` and COMMIT (for tests that seed data). */
async function runAs(uid, fn) {
  await db.exec(
    `set role authenticated; set request.jwt.claims = '${JSON.stringify({ sub: uid })}'`,
  )
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; set request.jwt.claims = ''`)
  }
}

before(async () => {
  db = await new PGlite()
  await db.exec(sanitize(readFileSync(join(REPO, "supabase/tests/00_local_harness.sql"), "utf8")))
  for (const m of MIGRATIONS) {
    await db.exec(sanitize(readFileSync(join(REPO, `supabase/migrations/${m}.sql`), "utf8")))
  }
  // 0011 already seeds EURUSD, XAUUSD, BTCUSDT… — just add our test users and
  // make USER_A an administrator.
  await db.exec(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'a@test.dev'), ('${USER_B}', 'b@test.dev')
      on conflict (id) do nothing;
    insert into public.admin_users (user_id) values ('${USER_A}')
      on conflict (user_id) do nothing;
  `)
  const inst = await db.query(
    `select 1 from public.instruments where symbol='EURUSD' and active`,
  )
  assert.equal(inst.rows.length, 1, "EURUSD seeded and active")
})

test("0013: candle_coverage + ingest log tables exist with RLS", async () => {
  const t = await db.query(`
    select tablename from pg_tables
    where schemaname='public' and tablename in ('candle_coverage','market_data_ingest_log')
    order by 1`)
  assert.deepEqual(t.rows.map((r) => r.tablename), ["candle_coverage", "market_data_ingest_log"])

  const rls = await db.query(`
    select relname, relrowsecurity from pg_class
    where relname in ('candle_coverage','market_data_ingest_log')`)
  for (const r of rls.rows) assert.equal(r.relrowsecurity, true, `${r.relname} RLS`)
})

test("ingest_market_data: rejects an unauthenticated caller", async () => {
  await assert.rejects(
    () => db.query(`select public.ingest_market_data('EURUSD','H1','[]'::jsonb)`),
    /authentication required/,
  )
})

test("ingest_market_data: rejects an unknown instrument", async () => {
  await asUser(USER_B, async () => {
    await assert.rejects(
      () =>
        db.query(
          `select public.ingest_market_data('FAKEPAIR','H1', $1::jsonb)`,
          [JSON.stringify([{ ts: "2026-01-05T00:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 0 }])],
        ),
      /unknown or inactive instrument/,
    )
  })
})

test("ingest_market_data: any authenticated user can store bars for a real instrument, and it is idempotent + audited", async () => {
  const bars = Array.from({ length: 5 }, (_, i) => ({
    ts: new Date(Date.UTC(2026, 0, 5, i)).toISOString(),
    open: 1.1, high: 1.11, low: 1.09, close: 1.1, volume: 100,
  }))

  await asUser(USER_B, async () => {
    const r1 = await db.query(
      `select public.ingest_market_data('EURUSD','H1',$1::jsonb,'2026-01-05T00:00:00Z','2026-01-05T05:00:00Z') v`,
      [JSON.stringify(bars)],
    )
    assert.equal(r1.rows[0].v.ingested, 5)

    const stored = await db.query(
      `select count(*)::int c from public.candles where symbol='EURUSD' and timeframe='H1'`,
    )
    assert.equal(stored.rows[0].c, 5)

    // Re-ingest the same bars -> upsert, still 5 rows.
    const r2 = await db.query(
      `select public.ingest_market_data('EURUSD','H1',$1::jsonb) v`,
      [JSON.stringify(bars)],
    )
    assert.equal(r2.rows[0].v.ingested, 5)
    const still = await db.query(
      `select count(*)::int c from public.candles where symbol='EURUSD' and timeframe='H1'`,
    )
    assert.equal(still.rows[0].c, 5)

    const log = await db.query(
      `select count(*)::int c from public.market_data_ingest_log where user_id='${USER_B}'`,
    )
    assert.equal(log.rows[0].c, 2)

    // Coverage is recorded only for calls that carry an explicit range.
    const cov = await db.query(
      `select range_start, range_end from public.candle_coverage
       where symbol='EURUSD' and timeframe='H1' order by created_at`,
    )
    assert.equal(cov.rows.length, 1)
    assert.equal(new Date(cov.rows[0].range_start).toISOString(), "2026-01-05T00:00:00.000Z")
    assert.equal(new Date(cov.rows[0].range_end).toISOString(), "2026-01-05T05:00:00.000Z")
  })
})

test("ingest_market_data: drops OHLC-inconsistent bars, keeps the valid ones", async () => {
  await asUser(USER_B, async () => {
    const mixed = [
      { ts: "2026-02-01T00:00:00Z", open: 1.1, high: 1.11, low: 1.09, close: 1.1, volume: 1 }, // ok
      { ts: "2026-02-01T01:00:00Z", open: 1.1, high: 1.0, low: 1.2, close: 1.1, volume: 1 },   // high < low
      { ts: "2026-02-01T02:00:00Z", open: -5, high: 1, low: 1, close: 1, volume: 1 },          // negative
    ]
    const r = await db.query(
      `select public.ingest_market_data('EURUSD','H1',$1::jsonb) v`,
      [JSON.stringify(mixed)],
    )
    assert.equal(r.rows[0].v.ingested, 1)
    assert.equal(r.rows[0].v.skipped, 2)
  })
})

test("ingest_market_data: enforces the rolling 24h bar limit", async () => {
  // Seed a near-limit history for USER_B as the table owner (no INSERT policy
  // exists — the RPC writes it as SECURITY DEFINER).
  await db.query(
    `insert into public.market_data_ingest_log (user_id, symbol, timeframe, bars_ingested)
     values ('${USER_B}','EURUSD','M1', 499999)`,
  )
  await asUser(USER_B, async () => {
    await assert.rejects(
      () =>
        db.query(`select public.ingest_market_data('EURUSD','H1',$1::jsonb) v`, [
          JSON.stringify([
            { ts: "2026-03-01T00:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 0 },
            { ts: "2026-03-01T01:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 0 },
          ]),
        ]),
      /ingestion limit reached/,
    )
  })
})

test("import_candles is still admin-only (0006 regression check)", async () => {
  await asUser(USER_B, async () => {
    await assert.rejects(
      () =>
        db.query(`select public.import_candles($1::jsonb)`, [
          JSON.stringify([{ symbol: "EURUSD", timeframe: "H1", ts: "2026-01-05T00:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 0 }]),
        ]),
      /restricted to administrators/,
    )
  })
  await asUser(USER_A, async () => {
    const r = await db.query(`select public.import_candles($1::jsonb) n`, [
      JSON.stringify([{ symbol: "EURUSD", timeframe: "H1", ts: "2026-06-05T00:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 0 }]),
    ])
    assert.equal(r.rows[0].n, 1)
  })
})

test("replay_sessions gained the dataset snapshot columns", async () => {
  const cols = await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='replay_sessions'
      and column_name in ('dataset_bars','dataset_first_ts','dataset_last_ts')
    order by 1`)
  assert.deepEqual(cols.rows.map((r) => r.column_name), [
    "dataset_bars", "dataset_first_ts", "dataset_last_ts",
  ])
})

test("replay_sessions: cursor CHECK constraint rejects an out-of-range cursor", async () => {
  const sess = await db.query(
    `insert into public.backtest_sessions (user_id, name) values ('${USER_B}','S1') returning id`,
  )
  const sessionId = sess.rows[0].id
  await asUser(USER_B, async () => {
    await assert.rejects(
      () =>
        db.query(`
          insert into public.replay_sessions
            (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts, speed)
          values ('${USER_B}','${sessionId}','EURUSD','H1',
            '2026-01-01T00:00:00Z','2026-01-10T00:00:00Z','2026-02-01T00:00:00Z', 1)`),
      /replay_sessions_cursor_in_range/,
    )
  })
})

test("replay_sessions: a valid replay stores the dataset fingerprint", async () => {
  const sess = await db.query(
    `insert into public.backtest_sessions (user_id, name) values ('${USER_B}','S2') returning id`,
  )
  const sessionId = sess.rows[0].id
  await asUser(USER_B, async () => {
    const ok = await db.query(`
      insert into public.replay_sessions
        (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts, speed, dataset_bars, dataset_first_ts, dataset_last_ts)
      values ('${USER_B}','${sessionId}','EURUSD','H1',
        '2026-01-01T00:00:00Z','2026-01-10T00:00:00Z','2026-01-01T00:00:00Z', 1,
        216, '2026-01-01T00:00:00Z', '2026-01-10T00:00:00Z')
      returning dataset_bars`)
    assert.equal(ok.rows[0].dataset_bars, 216)
  })
})

test("replay_sessions: ownership guard — cannot attach a replay to another user's session", async () => {
  const sess = await db.query(
    `insert into public.backtest_sessions (user_id, name) values ('${USER_B}','S3') returning id`,
  )
  const sessionId = sess.rows[0].id
  await asUser(USER_A, async () => {
    await assert.rejects(
      () =>
        db.query(`
          insert into public.replay_sessions
            (user_id, session_id, symbol, timeframe, range_start, range_end, cursor_ts, speed)
          values ('${USER_A}','${sessionId}','EURUSD','H1',
            '2026-01-01T00:00:00Z','2026-01-10T00:00:00Z','2026-01-01T00:00:00Z', 1)`),
      /does not belong to the current user/,
    )
  })
})

test("advanceReplay reveal query: only bars in (cursor, range_end], ordered, limited", async () => {
  const bars = Array.from({ length: 20 }, (_, i) => ({
    symbol: "EURUSD", timeframe: "M15",
    ts: new Date(Date.UTC(2026, 3, 1, 0, i * 15)).toISOString(),
    open: 1, high: 1, low: 1, close: 1, volume: 0,
  }))
  await runAs(USER_A, () =>
    db.query(`select public.import_candles($1::jsonb)`, [JSON.stringify(bars)]),
  )

  const cursor = new Date(Date.UTC(2026, 3, 1, 0, 30)).toISOString()
  const rangeEnd = new Date(Date.UTC(2026, 3, 1, 2, 0)).toISOString()

  const revealed = await db.query(
    `select ts from public.candles
     where symbol='EURUSD' and timeframe='M15' and ts > $1 and ts <= $2
     order by ts asc limit 3`,
    [cursor, rangeEnd],
  )
  assert.equal(revealed.rows.length, 3)
  assert.ok(new Date(revealed.rows[0].ts).getTime() > new Date(cursor).getTime())
  for (let i = 1; i < revealed.rows.length; i += 1) {
    assert.ok(
      new Date(revealed.rows[i].ts).getTime() >
        new Date(revealed.rows[i - 1].ts).getTime(),
    )
  }
})
