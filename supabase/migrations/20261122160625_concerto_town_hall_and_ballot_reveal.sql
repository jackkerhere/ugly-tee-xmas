-- A durable server clock for Town Hall, shared readiness gates, and a
-- public aggregate ballot beat. No individual ballots leave the engine.
ALTER TABLE public.game_sessions
  ADD COLUMN town_hall_ends_at timestamptz;

CREATE FUNCTION private.game_turn_readiness(p_sess public.game_sessions)
RETURNS TABLE(expected integer, submitted integer)
LANGUAGE sql STABLE
SET search_path TO ''
AS $function$
  SELECT count(*)::int, count(*) FILTER (WHERE EXISTS (
    SELECT 1
    FROM public.game_actions AS a
    WHERE a.session_id = p_sess.id
      AND a.actor_id = p.guest_id
      AND a.phase = p_sess.phase
      AND a.night_number = p_sess.night_number
      AND a.day_number = p_sess.day_number
      AND CASE p_sess.phase
        WHEN 'night' THEN a.action IN ('steal', 'krampus_steal', 'save', 'guard', 'check', 'cocoa', 'coal', 'watch', 'skip')
        WHEN 'day' THEN a.action = 'vote'
        ELSE false
      END
  ))::int
  FROM public.game_players AS p
  WHERE p.session_id = p_sess.id
    AND p.alive
    AND (
      p_sess.phase = 'night'
      OR (
        p_sess.phase = 'day'
        AND p.guest_id IS DISTINCT FROM p_sess.haunted_guest_id
        AND p.guest_id IS DISTINCT FROM p_sess.hangover_guest_id
        AND (p_sess.possess_vote_for_id IS NULL OR p.guest_id IS DISTINCT FROM p_sess.possess_voter_id)
      )
    );
$function$;

REVOKE ALL ON FUNCTION private.game_turn_readiness(public.game_sessions) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.game_host_start_town_hall(p_host_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
BEGIN
  sess := private.game_lock_host_session(p_host_token);
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Host login required.');
  END IF;

  -- Retrying an active or elapsed countdown returns the same clock and ballot.
  IF sess.phase = 'day' AND sess.town_hall_ends_at IS NOT NULL THEN
    RETURN private.game_host_state(p_host_token);
  END IF;
  IF sess.phase IS DISTINCT FROM 'twist' OR sess.reveal_mode IS DISTINCT FROM 'post_morning' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Wait for Town Hall to open.');
  END IF;

  UPDATE public.game_sessions
  SET phase = 'day',
      day_number = night_number,
      town_hall_ends_at = clock_timestamp() + interval '3 minutes 30 seconds',
      updated_at = now()
  WHERE id = sess.id;
  RETURN private.game_host_state(p_host_token);
END;
$function$;

CREATE FUNCTION public.game_host_start_town_hall(host_token text)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.game_host_start_town_hall(host_token);
$function$;

REVOKE ALL ON FUNCTION
  private.game_host_start_town_hall(text), public.game_host_start_town_hall(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  private.game_host_start_town_hall(text), public.game_host_start_town_hall(text)
TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.game_public_payload(p_sess game_sessions)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  players jsonb;
  events jsonb;
  winner_text text;
  reveal jsonb;
  dealt boolean := false;
  hidden_eliminations text[] := ARRAY[]::text[];
  town_hall_pending boolean;
  winner_is_public boolean;
BEGIN
  IF p_sess.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'phase', 'not_started',
      'dealt', false,
      'nightNumber', 0,
      'dayNumber', 0,
      'players', '[]'::jsonb,
      'announcement', NULL,
      'ghostClue', NULL,
      'winnerSide', NULL,
      'snowmanWon', false,
      'reveal', jsonb_build_object('active', false),
      'title', 'Who Stole Christmas?'
    );
  END IF;

  reveal := private.game_visible_reveal(p_sess);
  town_hall_pending := p_sess.phase = 'day' AND p_sess.town_hall_ends_at > statement_timestamp();
  winner_is_public := p_sess.phase = 'ended' OR coalesce(reveal->'current'->>'kind' = 'winner', false);

  -- Keep the previous public alive status for eliminations this round until
  -- each result beat. Already-announced deaths from prior rounds stay out.
  IF p_sess.phase IN ('reveal', 'gingerbread') THEN
    SELECT coalesce(array_agg(scene->>'targetId'), ARRAY[]::text[])
    INTO hidden_eliminations
    FROM jsonb_array_elements(private.game_reveal_scenes(p_sess.reveal_script))
      WITH ORDINALITY AS queued(scene, position)
    WHERE scene->>'targetId' IS NOT NULL
      AND ((scene->>'kind' IN ('hit', 'vote', 'gingerbread') AND scene->>'outcome' = 'out')
        OR scene->>'kind' = 'snowman')
      AND (p_sess.phase = 'gingerbread'
        OR position > p_sess.reveal_scene + 1
        OR (position = p_sess.reveal_scene + 1
          AND p_sess.reveal_beat + 1 < jsonb_array_length(private.game_reveal_beats(scene))));
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.game_players AS p WHERE p.session_id = p_sess.id
  ) INTO dealt;

  -- Public roster only after a shuffle. No roles, no lives.
  IF dealt THEN
    SELECT coalesce(jsonb_agg(x.obj ORDER BY x.alive DESC, x.name), '[]'::jsonb)
    INTO players
    FROM (
      SELECT jsonb_build_object(
        'id', g.id,
        'display_name', g.display_name,
        'alive', p.alive OR p.guest_id::text = ANY (hidden_eliminations)
      ) AS obj,
      p.alive OR p.guest_id::text = ANY (hidden_eliminations) AS alive,
      g.display_name AS name
      FROM public.game_players AS p
      JOIN public.guests AS g ON g.id = p.guest_id
      WHERE p.session_id = p_sess.id
    ) AS x;
  ELSE
    players := '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'kind', e.kind,
    'text', e.public_text,
    'nightNumber', e.night_number,
    'dayNumber', e.day_number
  ) ORDER BY e.created_at), '[]'::jsonb)
  INTO events
  FROM public.game_events AS e
  WHERE e.session_id = p_sess.id;

  IF p_sess.winner_side = 'nice' THEN
    winner_text := 'The nice side wins! Every Grinch and Krampus is out.';
  ELSIF p_sess.winner_side = 'grinches' THEN
    winner_text := 'The Grinches win! There are at least as many living Grinches as everyone else still alive.';
  ELSIF p_sess.winner_side = 'krampus' THEN
    winner_text := 'Krampus wins — the last one standing.';
  ELSIF p_sess.winner_side = 'no_team' THEN
    winner_text := 'No team won the round.';
  END IF;
  IF p_sess.ghosts_bonus IS TRUE THEN
    winner_text := coalesce(winner_text, '') || ' The ghosts predicted it: every ghost spins the gachapon.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'phase', CASE
      WHEN p_sess.phase = 'gingerbread' THEN 'reveal'
      WHEN town_hall_pending THEN 'town_hall'
      ELSE p_sess.phase
    END,
    'townHallEndsAt', CASE WHEN town_hall_pending THEN p_sess.town_hall_ends_at END,
    'serverNow', CASE WHEN town_hall_pending THEN statement_timestamp() END,
    'dealt', dealt,
    'nightNumber', p_sess.night_number,
    'dayNumber', p_sess.day_number,
    'players', players,
    'announcement', p_sess.announcement,
    'ghostClue', NULL,
    'hauntedName', NULL,
    'leakedInnocentName', CASE WHEN p_sess.leaked_innocent_id IS NOT NULL
      THEN private.game_guest_name(p_sess.leaked_innocent_id) ELSE NULL END,
    'winnerSide', CASE WHEN winner_is_public THEN p_sess.winner_side END,
    'winnerText', CASE WHEN winner_is_public THEN winner_text END,
    'snowmanWon', p_sess.phase = 'ended' AND p_sess.snowman_won,
    'ghostsBonus', winner_is_public AND p_sess.ghosts_bonus,
    'activeTwist', p_sess.active_twist,
    'title', 'Who Stole Christmas?',
    'events', events,
    'reveal', reveal
  ) || CASE WHEN p_sess.phase = 'ended' THEN
    jsonb_build_object('krampusWon', EXISTS (
      SELECT 1
      FROM private.game_krampus_eliminations AS e
      WHERE e.session_id = p_sess.id
      GROUP BY e.session_id
      HAVING count(*) = 2
    ))
  ELSE '{}'::jsonb END;
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_host_state(p_host_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  payload jsonb;
  players jsonb;
  submitted jsonb;
  expected int;
  got int;
  twist_window text;
BEGIN
  sess := private.game_host_by_token(p_host_token);
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Host login required.');
  END IF;

  payload := private.game_public_payload(sess);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'display_name', g.display_name,
    'role', p.role,
    'roleName', private.game_role_name(p.role),
    'alive', p.alive,
    'lives', p.lives,
    'livesMax', p.lives_max,
    'deathCause', p.death_cause,
    'prediction', p.prediction
  ) ORDER BY p.alive DESC, g.display_name), '[]'::jsonb)
  INTO players
  FROM public.game_players AS p
  JOIN public.guests AS g ON g.id = p.guest_id
  WHERE p.session_id = sess.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'display_name', g.display_name,
    'actions', sub.actions
  ) ORDER BY g.display_name), '[]'::jsonb)
  INTO submitted
  FROM (
    SELECT a.actor_id, array_agg(a.action ORDER BY a.created_at) AS actions
    FROM public.game_actions AS a
    WHERE a.session_id = sess.id
      AND a.phase = sess.phase
      AND a.night_number = sess.night_number
      AND a.day_number = sess.day_number
    GROUP BY a.actor_id
  ) AS sub
  JOIN public.guests AS g ON g.id = sub.actor_id;

  IF sess.phase IN ('night', 'day') THEN
    SELECT readiness.expected, readiness.submitted INTO expected, got
    FROM private.game_turn_readiness(sess) AS readiness;
  ELSIF sess.phase = 'gingerbread' THEN
    expected := CASE WHEN sess.pending_gingerbread_id IS NOT NULL THEN 1 ELSE 0 END;
    SELECT count(DISTINCT a.actor_id)::int INTO got
    FROM public.game_actions AS a
    WHERE a.session_id = sess.id
      AND a.phase = 'gingerbread'
      AND a.night_number = sess.night_number
      AND a.day_number = sess.day_number
      AND a.action = 'gingerbread';
  ELSE
    expected := 0;
    got := 0;
  END IF;

  twist_window := CASE
    WHEN sess.phase = 'twist' THEN coalesce(sess.reveal_mode, 'post_morning')
    ELSE NULL
  END;

  payload := payload || jsonb_build_object(
    'ok', true,
    'isHost', true,
    'phase', CASE WHEN sess.phase = 'gingerbread' THEN sess.phase ELSE payload->>'phase' END,
    'winnerSide', sess.winner_side,
    'snowmanWon', sess.snowman_won,
    'ghostsBonus', sess.ghosts_bonus,
    'hostName', CASE WHEN sess.host_guest_id IS NOT NULL THEN private.game_guest_name(sess.host_guest_id) ELSE NULL END,
    'script', private.game_script(sess.phase, sess.night_number, sess.day_number),
    'roles', players,
    'lobby', (
      SELECT jsonb_build_object(
        'open', sess.phase IN ('not_started', 'setup'),
        'count', count(*)::int,
        'minPlayers', 5,
        'maxPlayers', 15,
        'members', coalesce(jsonb_agg(
          jsonb_build_object('id', g.id, 'display_name', g.display_name)
          ORDER BY g.display_name, g.id
        ), '[]'::jsonb)
      )
      FROM private.game_lobby_roster(sess) AS l
      JOIN public.guests AS g ON g.id = l.guest_id
    ),
    'submitted', submitted,
    'submittedCount', coalesce(got, 0),
    'expectedCount', coalesce(expected, 0),
    'canAdvance', CASE
      WHEN sess.phase IN ('night', 'day') THEN got >= expected AND payload->>'phase' <> 'town_hall'
      ELSE sess.phase IN ('reveal', 'gingerbread')
    END,
    'canStartTownHall', sess.phase = 'twist' AND twist_window = 'post_morning',
    'pendingGingerbreadId', sess.pending_gingerbread_id,
    'witnessOf', sess.witness_of,
    'hasHostPin', sess.host_pin_hash IS NOT NULL,
    'canShuffle', sess.phase IN ('not_started','setup','shuffled'),
    'canStart', sess.phase = 'shuffled',
    'canReshuffle', sess.phase = 'shuffled',
    'canPlayNightBlizzard', sess.phase = 'night'
      AND sess.twist_used_night IS DISTINCT FROM sess.night_number
      AND (sess.blizzard_night IS NULL OR sess.blizzard_night < sess.night_number),
    'nightBlizzardActive', sess.phase = 'night' AND sess.blizzard_night IS NOT DISTINCT FROM sess.night_number,
    'availableTwists', CASE WHEN sess.phase = 'twist'
      THEN private.game_twist_available(sess, coalesce(twist_window, 'post_morning'))
      ELSE '[]'::jsonb END,
    'revealScript', CASE WHEN sess.phase = 'reveal' THEN
      CASE WHEN sess.reveal_mode = 'vote' AND sess.reveal_scene = 0 AND sess.reveal_beat = 0
        THEN sess.reveal_script #- '{scenes,0,voteTally}'
        ELSE sess.reveal_script
      END
    END,
    'livingForPicks', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'display_name', g.display_name, 'innocent', NOT private.game_is_bad(p.role)
      ) ORDER BY g.display_name), '[]'::jsonb)
      FROM public.game_players AS p
      JOIN public.guests AS g ON g.id = p.guest_id
      WHERE p.session_id = sess.id AND p.alive
    )
  );
  RETURN payload;
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_host_advance(p_host_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  scenes jsonb;
  n int;
  nb int;
  night_scenes jsonb;
  vote_scenes jsonb;
  gb_scenes jsonb;
  next_phase text;
  used boolean;
  expected_turn integer;
  submitted_turn integer;
BEGIN
  sess := private.game_lock_host_session(p_host_token);
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Host login required.');
  END IF;
  IF sess.phase IN ('not_started','setup') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Deal the roles first, then we can start the story.');
  END IF;
  IF sess.phase = 'ended' THEN
    RETURN private.game_host_state(p_host_token);
  END IF;
  IF sess.phase = 'twist' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Play a twist card, or skip.');
  END IF;

  IF sess.phase = 'day' AND sess.town_hall_ends_at > statement_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'message', 'Town Hall is still in progress.');
  END IF;
  IF sess.phase IN ('night', 'day') THEN
    SELECT readiness.expected, readiness.submitted INTO expected_turn, submitted_turn
    FROM private.game_turn_readiness(sess) AS readiness;
    IF submitted_turn < expected_turn THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not-ready',
        'message', CASE WHEN sess.phase = 'night' THEN 'Wait for all living players to lock in.' ELSE 'Wait for all eligible players to vote.' END,
        'expectedCount', expected_turn,
        'submittedCount', submitted_turn);
    END IF;
  END IF;

  IF sess.phase = 'reveal' THEN
    scenes := coalesce(sess.reveal_script->'scenes', '[]'::jsonb);
    n := jsonb_array_length(scenes);
    IF n = 0 THEN
      next_phase := 'done';
    ELSE
      nb := jsonb_array_length(coalesce(scenes->sess.reveal_scene->'beats', '[]'::jsonb));
      IF sess.reveal_beat + 1 < nb THEN
        UPDATE public.game_sessions
        SET reveal_beat = reveal_beat + 1, updated_at = now()
        WHERE id = sess.id;
        RETURN private.game_host_state(p_host_token);
      ELSIF sess.reveal_scene + 1 < n THEN
        UPDATE public.game_sessions
        SET reveal_scene = reveal_scene + 1, reveal_beat = 0, updated_at = now()
        WHERE id = sess.id;
        RETURN private.game_host_state(p_host_token);
      ELSE
        next_phase := 'done';
      END IF;
    END IF;

    -- Reveal finished.
    used := (sess.twist_used_night IS NOT NULL AND sess.twist_used_night = sess.night_number);
    IF sess.reveal_mode = 'intro' THEN
      UPDATE public.game_sessions SET phase = 'night', night_number = 1, updated_at = now() WHERE id = sess.id;
    ELSIF sess.reveal_mode IN ('night','gingerbread') THEN
      SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = sess.id;
      IF sess.winner_side IS NOT NULL THEN
        UPDATE public.game_sessions SET phase = 'ended', updated_at = now() WHERE id = sess.id;
      ELSE
        UPDATE public.game_sessions SET phase = 'twist', reveal_mode = 'post_morning', updated_at = now() WHERE id = sess.id;
      END IF;
    ELSIF sess.reveal_mode = 'twist' THEN
      IF sess.day_number < sess.night_number THEN
        UPDATE public.game_sessions SET phase = 'twist', reveal_mode = 'post_morning', updated_at = now() WHERE id = sess.id;
      ELSE
        UPDATE public.game_sessions SET phase = 'day', day_number = night_number, updated_at = now() WHERE id = sess.id;
      END IF;
    ELSIF sess.reveal_mode = 'recount' THEN
      UPDATE public.game_sessions SET phase = 'day', updated_at = now() WHERE id = sess.id;
    ELSIF sess.reveal_mode IN ('vote') THEN
      SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = sess.id;
      IF sess.winner_side IS NOT NULL THEN
        UPDATE public.game_sessions SET phase = 'ended', updated_at = now() WHERE id = sess.id;
      ELSIF NOT used THEN
        UPDATE public.game_sessions SET phase = 'twist', reveal_mode = 'post_vote', updated_at = now() WHERE id = sess.id;
      ELSE
        UPDATE public.game_sessions
        SET phase = 'night', night_number = night_number + 1, ghost_clue = NULL, updated_at = now()
        WHERE id = sess.id;
      END IF;
    ELSE
      UPDATE public.game_sessions SET phase = 'day', day_number = night_number, updated_at = now() WHERE id = sess.id;
    END IF;
    RETURN private.game_host_state(p_host_token);
  END IF;

  IF sess.phase = 'night' THEN
    PERFORM private.game_resolve_ghosts(sess.id);
    night_scenes := private.game_resolve_night(sess.id);
    SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = sess.id;
    IF sess.pending_gingerbread_id IS NOT NULL THEN
      UPDATE public.game_sessions
      SET phase = 'gingerbread',
          reveal_mode = 'night',
          reveal_script = jsonb_build_object('mode', 'night', 'scenes', night_scenes),
          updated_at = now()
      WHERE id = sess.id;
    ELSE
      PERFORM private.game_start_reveal(sess.id, 'night', private.game_append_winner(sess.id, night_scenes));
    END IF;
    RETURN private.game_host_state(p_host_token);
  END IF;

  IF sess.phase = 'day' THEN
    vote_scenes := private.game_resolve_vote(sess.id);
    UPDATE public.game_sessions SET town_hall_ends_at = NULL WHERE id = sess.id;
    SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = sess.id;
    IF sess.pending_gingerbread_id IS NOT NULL THEN
      UPDATE public.game_sessions
      SET phase = 'gingerbread',
          reveal_mode = 'vote',
          reveal_script = jsonb_build_object('mode', 'vote', 'scenes', vote_scenes),
          updated_at = now()
      WHERE id = sess.id;
    ELSE
      PERFORM private.game_start_reveal(sess.id, 'vote', private.game_append_winner(sess.id, vote_scenes));
    END IF;
    RETURN private.game_host_state(p_host_token);
  END IF;

  IF sess.phase = 'gingerbread' THEN
    gb_scenes := private.game_resolve_gingerbread(sess.id);
    SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = sess.id;
    -- Even with a delayed reprisal, finish all guest slides before the clue.
    SELECT coalesce(jsonb_agg(card ORDER BY (card->>'kind' = 'clue'), seq), '[]'::jsonb)
    INTO scenes
    FROM jsonb_array_elements(
      private.game_reveal_scenes(sess.reveal_script) || coalesce(gb_scenes, '[]'::jsonb)
    ) WITH ORDINALITY AS queued(card, seq);
    PERFORM private.game_start_reveal(
      sess.id,
      coalesce(sess.reveal_mode, 'night'),
      private.game_append_winner(sess.id, scenes)
    );
    RETURN private.game_host_state(p_host_token);
  END IF;

  RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Nothing to advance.');
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_host_skip_twist(p_host_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
BEGIN
  sess := private.game_lock_host_session(p_host_token);
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Host login required.');
  END IF;
  IF sess.phase IS DISTINCT FROM 'twist' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'No twist to skip.');
  END IF;
  IF coalesce(sess.reveal_mode, 'post_morning') = 'post_vote' THEN
    UPDATE public.game_sessions
    SET phase = 'night',
        night_number = night_number + 1,
        ghost_clue = NULL,
        active_twist = CASE WHEN blizzard_night = night_number + 1 THEN 'blizzard' ELSE NULL END,
        updated_at = now()
    WHERE id = sess.id;
  ELSE
    RETURN private.game_host_start_town_hall(p_host_token);
  END IF;
  RETURN private.game_host_state(p_host_token);
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_submit(p_token text, p_action text, p_target uuid DEFAULT NULL::uuid, p_extra uuid DEFAULT NULL::uuid, p_extra_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  me public.guests%ROWTYPE;
  sess public.game_sessions%ROWTYPE;
  pl public.game_players%ROWTYPE;
  tgt public.game_players%ROWTYPE;
  act text;
BEGIN
  me := private.guest_by_token(p_token);
  IF me.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not-found');
  END IF;
  -- Resolve and Close use the same session lock. An action that arrives
  -- after either transition cannot slip into the turn being resolved.
  SELECT s.* INTO sess
  FROM public.game_sessions AS s
  WHERE s.id = (private.game_current()).id AND s.is_current
  FOR UPDATE;
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'No game is running.');
  END IF;
  SELECT * INTO pl
  FROM public.game_players AS p
  WHERE p.session_id = sess.id AND p.guest_id = me.id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'You are not in this game.');
  END IF;

  act := trim(both FROM coalesce(p_action, ''));

  -- Predictions can be locked any time after the player is out, until the game ends.
  IF act = 'predict' THEN
    IF pl.alive THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Only ghosts predict.');
    END IF;
    IF sess.phase = 'ended' OR sess.winner_side IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'message', 'The game has ended.');
    END IF;
    IF p_extra_text IS NULL OR p_extra_text NOT IN ('nice','grinches','krampus') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick a side: nice, grinches, or krampus.');
    END IF;
    IF pl.prediction IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'message', 'Already locked in.');
    END IF;
    UPDATE public.game_players SET prediction = p_extra_text WHERE id = pl.id;
    RETURN private.game_lock_action(sess.id, sess.phase, sess.night_number, sess.day_number, me.id, 'predict', NULL, NULL, p_extra_text);
  END IF;

  IF act = 'gingerbread' THEN
    IF sess.phase IS DISTINCT FROM 'gingerbread' OR sess.pending_gingerbread_id IS DISTINCT FROM me.id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'It is not your moment to pick.');
    END IF;
    SELECT * INTO tgt FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
    IF tgt.guest_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone still in the game.');
    END IF;
    RETURN private.game_lock_action(sess.id, 'gingerbread', sess.night_number, sess.day_number, me.id, 'gingerbread', p_target);
  END IF;

  -- Ghost night actions
  IF act IN ('clue','haunt','possess') THEN
    IF pl.alive THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Only ghosts can do that.');
    END IF;
    IF sess.phase IS DISTINCT FROM 'night' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Wait for night.');
    END IF;
    IF act = 'clue' THEN
      SELECT * INTO tgt FROM public.game_players AS p
      WHERE p.session_id = sess.id AND p.guest_id = p_target AND NOT p.alive;
      IF tgt.guest_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone who is already out.');
      END IF;
      RETURN private.game_lock_action(sess.id, 'night', sess.night_number, sess.day_number, me.id, 'clue', p_target);
    END IF;
    IF act = 'haunt' THEN
      SELECT * INTO tgt FROM public.game_players AS p
      WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
      IF tgt.guest_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone still in the game.');
      END IF;
      RETURN private.game_lock_action(sess.id, 'night', sess.night_number, sess.day_number, me.id, 'haunt', p_target);
    END IF;
    IF act = 'possess' THEN
      IF sess.ghost_possess_used THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'The ghosts have already possessed a vote this game.');
      END IF;
      SELECT * INTO tgt FROM public.game_players AS p
      WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
      IF tgt.guest_id IS NULL OR p_extra IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick a living player and who their vote should be for.');
      END IF;
      IF p_extra = p_target THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'They cannot vote for themselves.');
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.game_players AS p
        WHERE p.session_id = sess.id AND p.guest_id = p_extra AND p.alive
      ) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick a living vote target.');
      END IF;
      RETURN private.game_lock_action(sess.id, 'night', sess.night_number, sess.day_number, me.id, 'possess', p_target, p_extra);
    END IF;
  END IF;

  IF act = 'vote' THEN
    IF NOT pl.alive THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Ghosts do not vote.');
    END IF;
    -- The host locks this same session row when closing the vote. A delayed
    -- ballot may only land in the voting round that the player just read.
    SELECT s.* INTO sess
    FROM public.game_sessions AS s
    WHERE s.id = sess.id AND s.is_current
      AND s.phase = 'day'
      AND s.night_number = sess.night_number AND s.day_number = sess.day_number
    FOR UPDATE;
    IF NOT FOUND OR sess.town_hall_ends_at > statement_timestamp() THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Voting is not open.');
    END IF;
    IF sess.haunted_guest_id = me.id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'You are haunted and cannot vote today.');
    END IF;
    IF sess.hangover_guest_id = me.id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Egg-nog hangover: you cannot vote today.');
    END IF;
    -- A spare ballot uses the existing vote action and the same lock as a
    -- player ballot. Null by itself has never been a vote.
    IF p_extra_text = 'spare' THEN
      IF p_target IS NOT NULL OR p_extra IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Choose a player or Spare everyone.');
      END IF;
      RETURN private.game_lock_action(sess.id, 'day', sess.night_number, sess.day_number, me.id, 'vote', NULL, NULL, 'spare');
    END IF;
    SELECT * INTO tgt FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
    IF tgt.guest_id IS NULL OR p_target = me.id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone else who is still in the game.');
    END IF;
    RETURN private.game_lock_action(sess.id, 'day', sess.night_number, sess.day_number, me.id, 'vote', p_target);
  END IF;

  -- Night actions for the living
  IF sess.phase IS DISTINCT FROM 'night' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Wait for the host to start the night.');
  END IF;
  IF NOT pl.alive THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Ghosts use the ghost actions.');
  END IF;

  IF act IN ('watch','skip') THEN
    -- Dummy or a Mrs Claus pass. Always allowed so every living player can lock something in.
    RETURN private.game_lock_action(sess.id, 'night', sess.night_number, sess.day_number, me.id, act, p_target);
  END IF;

  IF act = 'steal' THEN
    IF NOT private.game_is_grinch(pl.role) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    SELECT * INTO tgt FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
    IF tgt.guest_id IS NULL OR p_target = me.id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone else who is still in the game.');
    END IF;
    RETURN private.game_lock_action(sess.id, 'night', sess.night_number, sess.day_number, me.id, 'steal', p_target);
  END IF;

  IF act = 'krampus_steal' THEN
    IF pl.role IS DISTINCT FROM 'krampus' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    SELECT * INTO tgt FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
    IF tgt.guest_id IS NULL OR p_target = me.id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone else who is still in the game.');
    END IF;
    RETURN private.game_lock_action(sess.id, 'night', sess.night_number, sess.day_number, me.id, 'krampus_steal', p_target);
  END IF;

  IF act = 'save' THEN
    IF pl.role IS DISTINCT FROM 'santa' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    SELECT * INTO tgt FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
    IF tgt.guest_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone still in the game.');
    END IF;
    IF pl.last_santa_target_id IS NOT NULL AND pl.last_santa_target_id = p_target THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Santa cannot save the same person two nights in a row.');
    END IF;
    RETURN private.game_lock_action(sess.id, 'night', sess.night_number, sess.day_number, me.id, 'save', p_target);
  END IF;

  IF act = 'guard' THEN
    IF pl.role IS DISTINCT FROM 'reindeer' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    IF p_target = me.id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'The Reindeer cannot guard themselves.');
    END IF;
    SELECT * INTO tgt FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
    IF tgt.guest_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone still in the game.');
    END IF;
    RETURN private.game_lock_action(sess.id, 'night', sess.night_number, sess.day_number, me.id, 'guard', p_target);
  END IF;

  IF act = 'check' THEN
    IF pl.role IS DISTINCT FROM 'detective' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    IF p_target = me.id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone else.');
    END IF;
    SELECT * INTO tgt FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
    IF tgt.guest_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone still in the game.');
    END IF;
    RETURN private.game_lock_action(sess.id, 'night', sess.night_number, sess.day_number, me.id, 'check', p_target);
  END IF;

  IF act IN ('cocoa','coal') THEN
    IF pl.role IS DISTINCT FROM 'mrs_claus' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    IF act = 'cocoa' AND pl.cocoa_used THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Hot Cocoa has already been used.');
    END IF;
    IF act = 'coal' AND pl.coal_used THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Coal has already been used.');
    END IF;
    -- One item per night: either cocoa or coal (skip is the other path).
    IF EXISTS (
      SELECT 1 FROM public.game_actions AS a
      WHERE a.session_id = sess.id AND a.phase = 'night' AND a.night_number = sess.night_number
        AND a.actor_id = me.id AND a.action IN ('cocoa','coal','skip','watch')
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'message', 'Already locked in.');
    END IF;
    IF act = 'coal' THEN
      SELECT * INTO tgt FROM public.game_players AS p
      WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
      IF tgt.guest_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone still in the game.');
      END IF;
    END IF;
    RETURN private.game_lock_action(sess.id, 'night', sess.night_number, sess.day_number, me.id, act, CASE WHEN act = 'coal' THEN p_target ELSE NULL END);
  END IF;

  RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Unknown action.');
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_resolve_vote(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  voted uuid;
  result text;
  pl public.game_players%ROWTYPE;
  scenes jsonb;
  leader_count int;
  vote_tally jsonb;
  scene_kind text := 'vote';
  scene_outcome text;
BEGIN
  SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = p_session_id FOR UPDATE;

  IF sess.possess_voter_id IS NOT NULL AND sess.possess_vote_for_id IS NOT NULL THEN
    INSERT INTO public.game_actions (
      session_id, night_number, day_number, phase, actor_id, action, target_id, extra_text
    ) VALUES (
      p_session_id, sess.night_number, sess.day_number, 'day',
      sess.possess_voter_id, 'vote', sess.possess_vote_for_id, 'possessed'
    )
    ON CONFLICT (session_id, phase, night_number, day_number, actor_id, action)
    DO UPDATE SET target_id = EXCLUDED.target_id, extra_text = 'possessed';
  END IF;

  -- Only explicit spare ballots enter the tally with a NULL target. Gift
  -- Swap carries the complete choice, including spare, to the other voter.
  WITH raw AS (
    SELECT a.actor_id, a.target_id
    FROM public.game_actions AS a
    WHERE a.session_id = p_session_id
      AND a.phase = 'day' AND a.night_number = sess.night_number
      AND a.day_number = sess.day_number AND a.action = 'vote'
      AND (a.target_id IS NOT NULL OR a.extra_text = 'spare')
  ),
  swapped AS (
    SELECT r.actor_id, ballot.target_id
    FROM raw AS r
    JOIN raw AS ballot ON ballot.actor_id = CASE r.actor_id
      WHEN sess.gift_swap_a THEN sess.gift_swap_b
      WHEN sess.gift_swap_b THEN sess.gift_swap_a
      ELSE r.actor_id
    END
  ),
  weighted AS (
    SELECT s.target_id FROM swapped AS s
    UNION ALL
    SELECT s.target_id FROM swapped AS s
    WHERE s.actor_id = sess.double_vote_guest_id
  ),
  tallied AS (
    SELECT w.target_id, count(*)::int AS c
    FROM weighted AS w
    GROUP BY w.target_id
  )
  SELECT
    (array_agg(t.target_id) FILTER (WHERE t.c = leaders.total))[1],
    (count(*) FILTER (WHERE t.c = leaders.total))::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'option', CASE WHEN t.target_id IS NULL THEN 'Spare everyone' ELSE g.display_name END,
      'votes', t.c
    ) ORDER BY t.c DESC, coalesce(g.display_name, 'Spare everyone'), t.target_id), '[]'::jsonb)
  INTO voted, leader_count, vote_tally
  FROM tallied AS t
  CROSS JOIN (SELECT max(top.c) AS total FROM tallied AS top) AS leaders
  LEFT JOIN public.guests AS g ON g.id = t.target_id;

  IF leader_count = 0 THEN
    scene_outcome := 'no_votes';
  ELSIF leader_count > 1 THEN
    voted := NULL;
    scene_outcome := 'tie';
  ELSIF voted IS NULL THEN
    scene_outcome := 'spared';
  ELSE
    SELECT * INTO pl
    FROM public.game_players AS p
    WHERE p.session_id = p_session_id AND p.guest_id = voted;
    result := private.game_apply_hit(p_session_id, voted, 'vote', 'day', sess.night_number);

    IF pl.role = 'snowman' AND result = 'out' THEN
      UPDATE public.game_sessions SET snowman_won = true, updated_at = now() WHERE id = p_session_id;
      scene_kind := 'snowman';
      scene_outcome := 'snowman';
    ELSIF result IN ('out', 'wounded') THEN
      scene_outcome := CASE WHEN result = 'out' THEN 'out' ELSE 'saved' END;
    ELSE
      voted := NULL;
      scene_outcome := 'tie';
    END IF;
  END IF;

  scenes := jsonb_build_array(
    private.game_scene(scene_kind, voted, scene_outcome,
      'The votes are in.', 'Vote tally', 'The village waits.', '')
      || jsonb_build_object('voteTally', vote_tally)
  );

  -- Day-only effects expire after the vote is resolved.
  UPDATE public.game_sessions
  SET announcement = NULL,
      haunted_guest_id = NULL,
      possess_voter_id = NULL,
      possess_vote_for_id = NULL,
      hangover_guest_id = NULL,
      gift_swap_a = NULL,
      gift_swap_b = NULL,
      double_vote_guest_id = NULL,
      updated_at = now()
  WHERE id = p_session_id;

  PERFORM private.game_check_win(p_session_id);
  PERFORM private.game_finish_predictions(p_session_id);
  RETURN scenes;
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_public_reveal_card(p_scene jsonb, p_visible_beats integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  kind text := p_scene->>'kind';
  outcome text := p_scene->>'outcome';
  target_id jsonb := p_scene->'targetId';
  stored_beats jsonb := private.game_reveal_beats(p_scene);
  beat_count int := jsonb_array_length(stored_beats);
  name text;
  visible_beats jsonb;
BEGIN
  IF kind = 'snowman' THEN
    -- A mid-game Snowman announcement would identify the just-eliminated guest.
    kind := 'vote';
    outcome := 'out';
  ELSIF kind = 'gingerbread' THEN
    IF outcome IN ('out', 'saved') THEN
      kind := 'hit';
    ELSE
      kind := 'interlude';
      outcome := NULL;
      target_id := NULL;
    END IF;
  END IF;

  IF kind IN ('hit', 'vote', 'interlude') THEN
    SELECT g.display_name INTO name
    FROM public.guests AS g
    WHERE g.id::text = target_id #>> '{}';
    name := coalesce(name, 'A villager');

    SELECT coalesce(jsonb_agg(jsonb_build_object('text', CASE
      WHEN kind = 'interlude' THEN 'The village waits for news.'
      WHEN beat = beat_count THEN CASE outcome
        WHEN 'out' THEN name || ' became a ghost.'
        WHEN 'saved' THEN name || ' survived.'
        WHEN 'tie' THEN 'Nobody was voted out.'
        WHEN 'spared' THEN 'Spare everyone won. No one was voted out.'
        WHEN 'no_votes' THEN 'No votes were counted. No one was voted out.'
        ELSE 'Concerto waits for the next announcement.'
      END
      WHEN kind = 'vote' AND p_scene ? 'voteTally' AND beat = 2 THEN 'Vote tally'
      WHEN beat = beat_count - 1 AND name <> 'A villager' THEN name || ' steps into the morning light.'
      WHEN kind = 'vote' AND p_scene ? 'voteTally' AND beat = 3 THEN 'The village waits.'
      WHEN kind = 'vote' THEN 'The votes are in.'
      ELSE 'Dawn breaks over Concerto.'
    END) ORDER BY beat), '[]'::jsonb)
    INTO visible_beats
    FROM generate_series(1, least(p_visible_beats, beat_count)) AS beat;

    -- A public guest's picture and their outcome are separate reveal beats.
    IF p_visible_beats < greatest(1, beat_count - 1) THEN
      target_id := NULL;
    END IF;
    IF p_visible_beats < beat_count THEN
      outcome := NULL;
    END IF;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('text', value->>'text') ORDER BY beat), '[]'::jsonb)
    INTO visible_beats
    FROM jsonb_array_elements(stored_beats) WITH ORDINALITY AS beats(value, beat)
    WHERE beat <= p_visible_beats;
  END IF;

  RETURN jsonb_build_object(
    'kind', kind,
    'targetId', target_id,
    'outcome', outcome,
    'beatCount', beat_count,
    'beats', visible_beats
  ) || CASE WHEN kind = 'vote' AND p_visible_beats >= 2 AND p_scene ? 'voteTally' THEN
    jsonb_build_object('voteTally', p_scene->'voteTally')
  ELSE '{}'::jsonb END;
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_resolve_night(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  steal_of uuid;
  krampus_of uuid;
  coal_of uuid;
  save_of uuid;
  guard_of uuid;
  cocoa_on boolean := false;
  reindeer_id uuid;
  reindeer_alive boolean := true;
  rec record;
  hit_ids uuid[] := ARRAY[]::uuid[];
  result text;
  is_saved boolean;
  det_target uuid;
  det_role text;
  scenes jsonb := '[]'::jsonb;
  cause text;
  krampus_target_side text;
  blizzard boolean := false;
BEGIN
  SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = p_session_id FOR UPDATE;
  blizzard := (sess.blizzard_night IS NOT NULL AND sess.blizzard_night = sess.night_number);

  -- Detective still works in a blizzard (information, not a kill or save).
  SELECT a.target_id INTO det_target
  FROM public.game_actions AS a
  WHERE a.session_id = p_session_id
    AND a.phase = 'night'
    AND a.night_number = sess.night_number
    AND a.action = 'check'
  LIMIT 1;
  IF det_target IS NOT NULL THEN
    SELECT p.role INTO det_role
    FROM public.game_players AS p
    WHERE p.session_id = p_session_id AND p.guest_id = det_target;
    UPDATE public.game_players
    SET last_check_target_id = det_target,
        last_check_is_bad = private.game_is_bad(det_role)
    WHERE session_id = p_session_id AND role = 'detective';
  END IF;

  IF blizzard THEN
    scenes := scenes || private.game_scene(
      'blizzard', NULL, 'quiet',
      VARIADIC ARRAY[
        private.game_pick_line(p_session_id, 'twist_blizzard_1'),
        private.game_pick_line(p_session_id, 'twist_blizzard_2'),
        private.game_pick_line(p_session_id, 'twist_blizzard_3')
      ]
    );
  ELSE
    steal_of := private.game_majority_target(p_session_id, 'night', sess.night_number, sess.day_number, 'steal');
    krampus_of := private.game_majority_target(p_session_id, 'night', sess.night_number, sess.day_number, 'krampus_steal');

    SELECT a.target_id INTO coal_of
    FROM public.game_actions AS a
    WHERE a.session_id = p_session_id
      AND a.phase = 'night' AND a.night_number = sess.night_number AND a.action = 'coal'
    LIMIT 1;

    SELECT a.target_id INTO save_of
    FROM public.game_actions AS a
    WHERE a.session_id = p_session_id
      AND a.phase = 'night' AND a.night_number = sess.night_number AND a.action = 'save'
    LIMIT 1;

    SELECT a.target_id INTO guard_of
    FROM public.game_actions AS a
    WHERE a.session_id = p_session_id
      AND a.phase = 'night' AND a.night_number = sess.night_number AND a.action = 'guard'
    LIMIT 1;

    SELECT true INTO cocoa_on
    FROM public.game_actions AS a
    WHERE a.session_id = p_session_id
      AND a.phase = 'night' AND a.night_number = sess.night_number AND a.action = 'cocoa'
    LIMIT 1;
    cocoa_on := coalesce(cocoa_on, false);

    SELECT p.guest_id INTO reindeer_id
    FROM public.game_players AS p
    WHERE p.session_id = p_session_id AND p.role = 'reindeer' AND p.alive
    LIMIT 1;

    IF save_of IS NOT NULL THEN
      UPDATE public.game_players
      SET last_santa_target_id = save_of
      WHERE session_id = p_session_id AND role = 'santa';
    END IF;
    IF coal_of IS NOT NULL THEN
      UPDATE public.game_players SET coal_used = true
      WHERE session_id = p_session_id AND role = 'mrs_claus';
    END IF;
    IF cocoa_on THEN
      UPDATE public.game_players SET cocoa_used = true
      WHERE session_id = p_session_id AND role = 'mrs_claus';
    END IF;

    IF steal_of IS NOT NULL THEN hit_ids := array_append(hit_ids, steal_of); END IF;
    IF krampus_of IS NOT NULL AND NOT (krampus_of = ANY (hit_ids)) THEN
      hit_ids := array_append(hit_ids, krampus_of);
    END IF;
    IF coal_of IS NOT NULL AND NOT (coal_of = ANY (hit_ids)) THEN
      hit_ids := array_append(hit_ids, coal_of);
    END IF;

    IF reindeer_id IS NOT NULL AND reindeer_id = ANY (hit_ids) THEN
      is_saved := (save_of IS NOT DISTINCT FROM reindeer_id);
      IF cocoa_on THEN
        is_saved := true;
        IF reindeer_id = (
          SELECT p.guest_id FROM public.game_players AS p
          WHERE p.session_id = p_session_id AND p.role = 'mrs_claus' LIMIT 1
        ) AND sess.night_number NOT IN (1, 2) THEN
          is_saved := (save_of IS NOT DISTINCT FROM reindeer_id);
        END IF;
      END IF;
      IF NOT is_saved THEN
        reindeer_alive := false;
      END IF;
    END IF;

    IF cardinality(hit_ids) IS NULL OR cardinality(hit_ids) = 0 THEN
      scenes := scenes || private.game_scene(
        'quiet', NULL, 'quiet',
        VARIADIC ARRAY[
          private.game_pick_line(p_session_id, 'quiet_1'),
          private.game_pick_line(p_session_id, 'quiet_2'),
          private.game_pick_line(p_session_id, 'quiet_3')
        ]
      );
    ELSE
      -- Sort by guest name, independent of which action selected them.
      FOR rec IN
        SELECT g.id AS gid, p.role
        FROM public.guests AS g
        JOIN public.game_players AS p ON p.session_id = p_session_id AND p.guest_id = g.id
        WHERE g.id = ANY (hit_ids)
        ORDER BY g.display_name, g.id
      LOOP
        is_saved := false;
        IF save_of IS NOT NULL AND rec.gid = save_of THEN
          is_saved := true;
        END IF;
        IF cocoa_on THEN
          IF rec.gid = (
            SELECT p.guest_id FROM public.game_players AS p
            WHERE p.session_id = p_session_id AND p.role = 'mrs_claus' LIMIT 1
          ) THEN
            IF sess.night_number IN (1, 2) THEN
              is_saved := true;
            END IF;
          ELSE
            is_saved := true;
          END IF;
        END IF;
        IF reindeer_id IS NOT NULL AND reindeer_alive AND guard_of IS NOT NULL AND rec.gid = guard_of THEN
          is_saved := true;
        END IF;

        cause := CASE
          WHEN rec.gid = steal_of THEN 'grinch'
          WHEN rec.gid = krampus_of THEN 'krampus'
          ELSE 'coal'
        END;
        result := CASE WHEN is_saved THEN 'saved'
          ELSE private.game_apply_hit(p_session_id, rec.gid, cause, 'night', sess.night_number)
        END;
        -- A Grinch overlap already takes cause precedence. Coal can also share a hit.
        IF result = 'out' AND cause = 'krampus' AND rec.gid IS DISTINCT FROM coal_of THEN
          krampus_target_side := CASE
            WHEN private.game_is_grinch(rec.role) THEN 'grinches'
            WHEN rec.role IN ('santa', 'reindeer', 'detective', 'mrs_claus', 'gingerbread',
                              'fruitcake', 'liar_elf', 'citizen', 'witness') THEN 'nice'
          END;
          IF krampus_target_side IS NOT NULL THEN
            INSERT INTO private.game_krampus_eliminations (session_id, target_side, night_number)
            VALUES (p_session_id, krampus_target_side, sess.night_number)
            ON CONFLICT (session_id, target_side) DO NOTHING;
          END IF;
        END IF;

        IF result IN ('saved', 'wounded', 'out') THEN
          scenes := scenes || private.game_public_reveal_card(
            private.game_scene('hit', rec.gid, CASE WHEN result = 'out' THEN 'out' ELSE 'saved' END,
              VARIADIC ARRAY['', '', '']),
            3
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Ghost actions still resolve before the night. They have no public cards.

  PERFORM private.game_check_win(p_session_id);
  PERFORM private.game_finish_predictions(p_session_id);

  UPDATE public.game_sessions
  SET announcement = NULL, updated_at = now()
  WHERE id = p_session_id;

  RETURN scenes;
END;
$function$;
