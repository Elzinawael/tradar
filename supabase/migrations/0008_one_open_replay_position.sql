-- TRADAR — at most one open position per replay
--
-- openReplayPosition() already checks for an existing open position before
-- inserting, but a check followed by an insert is a time-of-check/time-of-use
-- race: two requests arriving together both read zero and both insert, leaving
-- a replay with two open positions and double the intended risk. A double
-- click is enough to trigger it.
--
-- This partial unique index makes the invariant a property of the data rather
-- than of the code path. The second concurrent insert fails with a unique
-- violation, which the server action translates into the normal
-- "close the current position" message.
--
-- Partial, so it constrains ONLY open replay positions:
--   * closed replay trades are unconstrained — a replay accumulates many over
--     its run, all with the same replay_id
--   * manual backtest trades have replay_id null and are unaffected entirely
create unique index if not exists backtest_trades_one_open_position_per_replay
  on public.backtest_trades (replay_id)
  where status = 'open' and replay_id is not null;
