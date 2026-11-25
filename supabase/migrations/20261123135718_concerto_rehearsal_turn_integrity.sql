-- Preserve the first locked move and wait for every required choice.
-- Keep elimination health so a Recount can undo the vote exactly.
ALTER TABLE public.game_players ADD COLUMN lives_before_elimination integer;

CREATE OR REPLACE FUNCTION private.game_lock_action(p_session_id uuid, p_phase text, p_night integer, p_day integer, p_actor uuid, p_action text, p_target uuid, p_extra uuid DEFAULT NULL::uuid, p_extra_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- game_submit holds the session lock, shared with the host's turn advance.
  -- One choice per night spans skills and check-ins. Prediction is separate.
  IF p_phase = 'night' AND p_action <> 'predict' AND EXISTS (
    SELECT 1
    FROM public.game_actions AS a
    WHERE a.session_id = p_session_id
      AND a.phase = p_phase AND a.night_number = p_night AND a.day_number = p_day
      AND a.actor_id = p_actor AND a.action <> 'predict'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'message', 'Already locked in.');
  END IF;

  INSERT INTO public.game_actions (
    session_id, night_number, day_number, phase, actor_id, action, target_id, extra_id, extra_text
  ) VALUES (
    p_session_id, p_night, p_day, p_phase, p_actor, p_action, p_target, p_extra, p_extra_text
  );
  RETURN jsonb_build_object('ok', true, 'locked', true, 'action', p_action);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'message', 'Already locked in.');
END;
$function$;

CREATE FUNCTION private.game_possessed_voter(p_sess public.game_sessions)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path TO ''
AS $function$
  SELECT voter.guest_id
  FROM public.game_players AS voter
  JOIN public.game_players AS target ON target.session_id = voter.session_id
  WHERE voter.session_id = p_sess.id
    AND voter.guest_id = p_sess.possess_voter_id AND voter.alive
    AND target.guest_id = p_sess.possess_vote_for_id AND target.alive
    AND voter.guest_id IS DISTINCT FROM p_sess.haunted_guest_id
    AND voter.guest_id IS DISTINCT FROM p_sess.hangover_guest_id;
$function$;

REVOKE ALL ON FUNCTION private.game_possessed_voter(public.game_sessions) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.game_turn_readiness(p_sess public.game_sessions)
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
        WHEN 'gingerbread' THEN a.action = 'gingerbread'
        ELSE false
      END
  ))::int
  FROM public.game_players AS p
  WHERE p.session_id = p_sess.id
    AND (
      (p_sess.phase = 'night' AND p.alive)
      OR (
        p_sess.phase = 'day' AND p.alive
        AND p.guest_id IS DISTINCT FROM p_sess.haunted_guest_id
        AND p.guest_id IS DISTINCT FROM p_sess.hangover_guest_id
        AND p.guest_id IS DISTINCT FROM (SELECT private.game_possessed_voter(p_sess))
      )
      OR (
        p_sess.phase = 'gingerbread'
        AND p.guest_id = p_sess.pending_gingerbread_id
        AND EXISTS (
          SELECT 1 FROM public.game_players AS target
          WHERE target.session_id = p_sess.id AND target.alive
        )
      )
    );
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

  IF sess.phase IN ('night', 'day', 'gingerbread') THEN
    SELECT readiness.expected, readiness.submitted INTO expected, got
    FROM private.game_turn_readiness(sess) AS readiness;
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
      WHEN sess.phase IN ('night', 'day', 'gingerbread') THEN got >= expected AND payload->>'phase' <> 'town_hall'
      ELSE sess.phase = 'reveal'
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
  next_sess public.game_sessions%ROWTYPE;
  scenes jsonb;
  night_scenes jsonb;
  vote_scenes jsonb;
  gb_scenes jsonb;
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
  IF sess.phase IN ('night', 'day', 'gingerbread') THEN
    SELECT readiness.expected, readiness.submitted INTO expected_turn, submitted_turn
    FROM private.game_turn_readiness(sess) AS readiness;
    IF submitted_turn < expected_turn THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not-ready',
        'message', CASE sess.phase
          WHEN 'night' THEN 'Wait for all living players to lock in.'
          WHEN 'day' THEN 'Wait for all eligible players to vote.'
          WHEN 'gingerbread' THEN 'Wait for Gingerbread to lock in the final pick.'
        END,
        'expectedCount', expected_turn,
        'submittedCount', submitted_turn);
    END IF;
  END IF;

  IF sess.phase = 'reveal' THEN
    next_sess := private.game_next_reveal_state(sess);
    UPDATE public.game_sessions
    SET phase = next_sess.phase,
        night_number = next_sess.night_number,
        day_number = next_sess.day_number,
        reveal_mode = next_sess.reveal_mode,
        reveal_scene = next_sess.reveal_scene,
        reveal_beat = next_sess.reveal_beat,
        ghost_clue = next_sess.ghost_clue,
        updated_at = now()
    WHERE id = sess.id;
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

CREATE OR REPLACE FUNCTION private.game_check_win(p_session_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  n_alive int := 0;
  n_grinches int := 0;
  n_krampus int := 0;
  n_others int := 0;
  already text;
BEGIN
  -- A final Gingerbread hit can still change which team has the numbers.
  SELECT s.winner_side INTO already
  FROM public.game_sessions AS s
  WHERE s.id = p_session_id AND s.pending_gingerbread_id IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF already IS NOT NULL THEN
    RETURN already;
  END IF;

  SELECT
    count(*) FILTER (WHERE p.alive),
    count(*) FILTER (WHERE p.alive AND private.game_is_grinch(p.role)),
    count(*) FILTER (WHERE p.alive AND p.role = 'krampus')
  INTO n_alive, n_grinches, n_krampus
  FROM public.game_players AS p
  WHERE p.session_id = p_session_id;

  n_others := n_alive - n_grinches;

  IF n_alive = 0 OR (n_alive = 1 AND n_krampus = 1) THEN
    UPDATE public.game_sessions
    SET winner_side = 'no_team', updated_at = now()
    WHERE id = p_session_id AND winner_side IS NULL;
    RETURN 'no_team';
  END IF;

  IF n_grinches = 0 AND n_krampus = 0 THEN
    UPDATE public.game_sessions
    SET winner_side = 'nice', updated_at = now()
    WHERE id = p_session_id AND winner_side IS NULL;
    RETURN 'nice';
  END IF;

  IF n_grinches > 0 AND n_grinches >= n_others THEN
    UPDATE public.game_sessions
    SET winner_side = 'grinches', updated_at = now()
    WHERE id = p_session_id AND winner_side IS NULL;
    RETURN 'grinches';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_apply_hit(p_session_id uuid, p_guest_id uuid, p_cause text, p_phase text, p_night integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  pl public.game_players%ROWTYPE;
BEGIN
  SELECT * INTO pl
  FROM public.game_players AS p
  WHERE p.session_id = p_session_id AND p.guest_id = p_guest_id
  FOR UPDATE;

  IF NOT FOUND OR NOT pl.alive THEN
    RETURN 'already_out';
  END IF;

  IF p_phase = 'night' AND pl.lives > 1 THEN
    UPDATE public.game_players
    SET lives = lives - 1
    WHERE id = pl.id;
    RETURN 'wounded';
  END IF;

  UPDATE public.game_players
  SET alive = false,
      lives_before_elimination = pl.lives,
      lives = 0,
      died_night = p_night,
      died_phase = p_phase,
      death_cause = p_cause
  WHERE id = pl.id;

  IF pl.role = 'gingerbread' THEN
    UPDATE public.game_sessions
    SET pending_gingerbread_id = p_guest_id, updated_at = now()
    WHERE id = p_session_id AND pending_gingerbread_id IS NULL;
  END IF;

  RETURN 'out';
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_host_play_twist(p_host_token text, p_card text, p_target uuid DEFAULT NULL::uuid, p_target2 uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  card text;
  pl public.game_players%ROWTYPE;
  pl2 public.game_players%ROWTYPE;
  scenes jsonb := '[]'::jsonb;
  tname text;
  tname2 text;
  twist_window text;
  pick uuid;
BEGIN
  sess := private.game_lock_host_session(p_host_token);
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Host login required.');
  END IF;
  IF sess.twist_used_night IS NOT NULL AND sess.twist_used_night = sess.night_number THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'A twist has already been played today. You can skip.');
  END IF;
  card := trim(both FROM coalesce(p_card, ''));
  IF card = 'blizzard' THEN
    IF sess.phase IS DISTINCT FROM 'night' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Play Blizzard before resolving the night.');
    END IF;
    IF sess.blizzard_night >= sess.night_number THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'message', 'A Blizzard is already scheduled.');
    END IF;

    -- Keep the card private until the night reveal. The one-power limit
    -- follows night_number, which stays the same for the following morning.
    UPDATE public.game_sessions
    SET blizzard_night = sess.night_number,
        twist_used_night = sess.night_number,
        updated_at = now()
    WHERE id = sess.id;

    RETURN private.game_host_state(p_host_token);
  END IF;

  IF sess.phase IS DISTINCT FROM 'twist' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Twists are only played in the twist window.');
  END IF;
  twist_window := coalesce(sess.reveal_mode, 'post_morning');
  IF twist_window = 'post_vote' AND card <> 'recount' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Only Secret Recount is available after the vote.');
  END IF;

  IF card = 'naughty_list' THEN
    SELECT * INTO pl FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
    IF pl.guest_id IS NULL OR private.game_is_bad(pl.role) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick a living innocent — not a Grinch or Krampus.');
    END IF;
    tname := private.game_guest_name(pl.guest_id);
    UPDATE public.game_sessions
    SET active_twist = 'naughty_list',
        leaked_innocent_id = pl.guest_id,
        twist_target_id = pl.guest_id,
        twist_used_night = night_number,
        updated_at = now()
    WHERE id = sess.id;
    scenes := private.game_scene('twist', pl.guest_id, 'naughty_list', VARIADIC ARRAY[
      private.game_pick_line(sess.id, 'twist_leak_1'),
      private.game_pick_line(sess.id, 'twist_leak_2'),
      private.game_pick_line(sess.id, 'twist_leak_3', tname)
    ]);
  ELSIF card = 'gift_swap' THEN
    SELECT * INTO pl FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
    SELECT * INTO pl2 FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target2 AND p.alive;
    IF pl.guest_id IS NULL OR pl2.guest_id IS NULL OR pl.guest_id = pl2.guest_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick two different living players.');
    END IF;
    tname := private.game_guest_name(pl.guest_id);
    tname2 := private.game_guest_name(pl2.guest_id);
    UPDATE public.game_sessions
    SET active_twist = 'gift_swap',
        gift_swap_a = pl.guest_id,
        gift_swap_b = pl2.guest_id,
        twist_target_id = pl.guest_id,
        twist_target2_id = pl2.guest_id,
        twist_used_night = night_number,
        updated_at = now()
    WHERE id = sess.id;
    scenes := private.game_scene('twist', pl.guest_id, 'gift_swap', VARIADIC ARRAY[
      private.game_pick_line(sess.id, 'twist_swap_1'),
      private.game_pick_line(sess.id, 'twist_swap_2', tname, tname2),
      private.game_pick_line(sess.id, 'twist_swap_3', tname, tname2)
    ]);
  ELSIF card = 'hangover' THEN
    SELECT p.guest_id INTO pick
    FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.alive
      AND p.guest_id IS DISTINCT FROM sess.haunted_guest_id
    ORDER BY random()
    LIMIT 1;
    IF pick IS NULL THEN
      SELECT p.guest_id INTO pick FROM public.game_players AS p
      WHERE p.session_id = sess.id AND p.alive ORDER BY random() LIMIT 1;
    END IF;
    tname := private.game_guest_name(pick);
    UPDATE public.game_sessions
    SET active_twist = 'hangover',
        hangover_guest_id = pick,
        twist_target_id = pick,
        twist_used_night = night_number,
        updated_at = now()
    WHERE id = sess.id;
    scenes := private.game_scene('twist', pick, 'hangover', VARIADIC ARRAY[
      private.game_pick_line(sess.id, 'twist_hangover_1'),
      private.game_pick_line(sess.id, 'twist_hangover_2'),
      private.game_pick_line(sess.id, 'twist_hangover_3', tname)
    ]);
  ELSIF card = 'ugly_tee' THEN
    SELECT * INTO pl FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
    IF pl.guest_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick a living player whose tee is doing the most.');
    END IF;
    tname := private.game_guest_name(pl.guest_id);
    UPDATE public.game_sessions
    SET active_twist = 'ugly_tee',
        double_vote_guest_id = pl.guest_id,
        twist_target_id = pl.guest_id,
        twist_used_night = night_number,
        updated_at = now()
    WHERE id = sess.id;
    scenes := private.game_scene('twist', pl.guest_id, 'ugly_tee', VARIADIC ARRAY[
      private.game_pick_line(sess.id, 'twist_audit_1'),
      private.game_pick_line(sess.id, 'twist_audit_2'),
      private.game_pick_line(sess.id, 'twist_audit_3', tname)
    ]);
  ELSIF card = 'recount' THEN
    IF twist_window IS DISTINCT FROM 'post_vote' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'A Secret Recount is for after a vote.');
    END IF;
    -- The vote (and any Gingerbread plus-one) already resolved before this window.
    UPDATE public.game_players AS p
    SET alive = true,
        lives = coalesce(p.lives_before_elimination, greatest(p.lives, 1)),
        lives_before_elimination = NULL,
        died_night = NULL,
        died_phase = NULL,
        death_cause = NULL
    WHERE p.session_id = sess.id
      AND p.died_night = sess.night_number
      AND (
        (p.died_phase = 'day' AND p.death_cause = 'vote')
        OR (
          p.died_phase = 'gingerbread' AND p.death_cause = 'gingerbread'
          AND EXISTS (
            SELECT 1 FROM public.game_actions AS a
            WHERE a.session_id = sess.id
              AND a.night_number = sess.night_number AND a.day_number = sess.day_number
              AND a.phase = 'gingerbread' AND a.action = 'gingerbread'
              AND a.target_id = p.guest_id
          )
        )
      );
    DELETE FROM public.game_actions AS a
    WHERE a.session_id = sess.id
      AND (
        (a.phase = 'day' AND a.day_number = sess.day_number AND a.action = 'vote')
        OR (a.phase = 'gingerbread' AND a.night_number = sess.night_number
          AND a.day_number = sess.day_number AND a.action = 'gingerbread')
      );
    UPDATE public.game_sessions
    SET active_twist = 'recount',
        twist_used_night = night_number,
        pending_gingerbread_id = NULL,
        winner_side = NULL,
        snowman_won = EXISTS (
          SELECT 1 FROM public.game_players AS p
          WHERE p.session_id = sess.id AND p.role = 'snowman' AND NOT p.alive AND p.death_cause = 'vote'
        ),
        phase = 'reveal',
        reveal_mode = 'twist',
        updated_at = now()
    WHERE id = sess.id;
    scenes := private.game_scene('twist', NULL, 'recount', VARIADIC ARRAY[
      private.game_pick_line(sess.id, 'twist_recount_1'),
      private.game_pick_line(sess.id, 'twist_recount_2'),
      private.game_pick_line(sess.id, 'twist_recount_3')
    ]);
    PERFORM private.game_start_reveal(sess.id, 'recount', scenes);
    -- After the recount reveal, advance should return to day (see game_host_advance).
    RETURN private.game_host_state(p_host_token);
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Unknown twist card.');
  END IF;

  PERFORM private.game_start_reveal(sess.id, 'twist', scenes);
  RETURN private.game_host_state(p_host_token);
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
  santa_saved boolean;
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
        SELECT g.id AS gid, p.role, p.lives
        FROM public.guests AS g
        JOIN public.game_players AS p ON p.session_id = p_session_id AND p.guest_id = g.id
        WHERE g.id = ANY (hit_ids)
        ORDER BY g.display_name, g.id
      LOOP
        is_saved := false;
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

        -- Attribute the rescue only if removing Santa's chosen save
        -- would eliminate this guest despite the other active protections.
        santa_saved := save_of IS NOT NULL AND rec.gid = save_of
          AND NOT is_saved AND rec.lives <= 1;
        IF save_of IS NOT NULL AND rec.gid = save_of THEN
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
              VARIADIC ARRAY['', '', '', '', '', ''])
              || CASE WHEN santa_saved THEN jsonb_build_object('santaSaved', true) ELSE '{}'::jsonb END,
            6
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- A check-in or a Blizzard breaks the sequence of consecutive saves.
  UPDATE public.game_players
  SET last_santa_target_id = save_of
  WHERE session_id = p_session_id AND role = 'santa'
    AND last_santa_target_id IS DISTINCT FROM save_of;

  -- Ghost actions still resolve before the night. They have no public cards.

  PERFORM private.game_check_win(p_session_id);
  PERFORM private.game_finish_predictions(p_session_id);

  UPDATE public.game_sessions
  SET announcement = NULL, updated_at = now()
  WHERE id = p_session_id;

  RETURN scenes;
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
  possessed_voter uuid;
  result text;
  pl public.game_players%ROWTYPE;
  scenes jsonb;
  leader_count int;
  vote_tally jsonb;
  scene_kind text := 'vote';
  scene_outcome text;
BEGIN
  SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = p_session_id FOR UPDATE;

  possessed_voter := private.game_possessed_voter(sess);
  IF possessed_voter IS NOT NULL THEN
    INSERT INTO public.game_actions (
      session_id, night_number, day_number, phase, actor_id, action, target_id, extra_text
    ) VALUES (
      p_session_id, sess.night_number, sess.day_number, 'day',
      possessed_voter, 'vote', sess.possess_vote_for_id, 'possessed'
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
    -- If one of the pair cannot vote, the other keeps their ballot.
    SELECT r.actor_id, CASE WHEN ballot.actor_id IS NULL THEN r.target_id ELSE ballot.target_id END AS target_id
    FROM raw AS r
    LEFT JOIN raw AS ballot ON ballot.actor_id = CASE r.actor_id
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
