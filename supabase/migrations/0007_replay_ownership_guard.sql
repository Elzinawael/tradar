-- TRADAR — extend the backtest ownership guard to replay_id
--
-- assert_owns_backtest_related() (0004) validates that a simulated trade's
-- session_id and strategy_id belong to the caller, but replay_id was added
-- later in 0005 and was never covered. A user could therefore insert a trade
-- into their OWN session while pointing replay_id at another user's replay.
--
-- Impact was limited — RLS still hides the row from the replay's owner, and
-- advanceReplay() only ever sees the caller's own trades — so this is a data
-- integrity gap rather than a disclosure one. It is closed here so the
-- invariant "every foreign key on a simulated trade points at something the
-- caller owns" holds without exception.
--
-- This replaces the function body; the triggers created in 0004 continue to
-- reference it and do not need recreating.

create or replace function public.assert_owns_backtest_related()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  select user_id into owner from public.backtest_sessions where id = new.session_id;
  if owner is null or owner <> new.user_id then
    raise exception 'session_id does not belong to the current user';
  end if;

  if new.strategy_id is not null then
    select user_id into owner from public.strategies where id = new.strategy_id;
    if owner is null or owner <> new.user_id then
      raise exception 'strategy_id does not belong to the current user';
    end if;
  end if;

  if new.replay_id is not null then
    select user_id into owner from public.replay_sessions where id = new.replay_id;
    if owner is null or owner <> new.user_id then
      raise exception 'replay_id does not belong to the current user';
    end if;
  end if;

  return new;
end;
$$;
