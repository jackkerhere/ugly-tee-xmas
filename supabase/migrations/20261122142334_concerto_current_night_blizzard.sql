-- Play Blizzard during the current night without resolving it.
-- Reuse the night marker for both the current night and its following morning.
-- Keep older next-night schedules working without consuming the new morning's power.

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
    UPDATE public.game_players
    SET alive = true,
        lives = CASE WHEN lives_max > 1 THEN greatest(lives, 1) ELSE greatest(lives_max, 1) END,
        died_night = NULL,
        died_phase = NULL,
        death_cause = NULL
    WHERE session_id = sess.id
      AND died_night = sess.night_number
      AND died_phase IN ('day', 'gingerbread')
      AND death_cause IN ('vote', 'gingerbread');
    DELETE FROM public.game_actions AS a
    WHERE a.session_id = sess.id
      AND (
        (a.phase = 'day' AND a.day_number = sess.day_number AND a.action = 'vote')
        OR (a.phase = 'gingerbread' AND a.night_number = sess.night_number AND a.action = 'gingerbread')
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

CREATE OR REPLACE FUNCTION private.game_twist_available(p_sess game_sessions, p_window text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  cards jsonb := '[]'::jsonb;
  used boolean;
BEGIN
  used := (p_sess.twist_used_night IS NOT NULL AND p_sess.twist_used_night = p_sess.night_number);
  IF used OR p_sess.phase = 'ended' THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Before the vote, offer the morning cards. Afterward, only Recount remains.
  IF p_window = 'post_morning' THEN
    cards := cards || jsonb_build_object('id','naughty_list','name','Naughty List Leak','hint','You reveal one living innocent (not a Grinch or Krampus).','needsTarget', true)
                  || jsonb_build_object('id','gift_swap','name','Gift Swap','hint','Two living players swap votes today.','needsTarget', true, 'needsTarget2', true)
                  || jsonb_build_object('id','hangover','name','Egg-nog Hangover','hint','One random living player cannot vote today. You do not pick who.')
                  || jsonb_build_object('id','ugly_tee','name','Ugly Tee Audit','hint','You pick a living player. Their vote counts twice today.','needsTarget', true);
  ELSIF p_window = 'post_vote' THEN
    cards := cards || jsonb_build_object('id','recount','name','Secret Recount','hint','Wipe today’s votes and vote again.');
  END IF;
  RETURN cards;
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

  IF sess.phase = 'night' THEN
    SELECT count(*)::int INTO expected FROM public.game_players AS p WHERE p.session_id = sess.id;
  ELSIF sess.phase = 'day' THEN
    SELECT count(*)::int INTO expected
    FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.alive
      AND p.guest_id IS DISTINCT FROM sess.haunted_guest_id
      AND p.guest_id IS DISTINCT FROM sess.hangover_guest_id;
  ELSIF sess.phase = 'gingerbread' THEN
    expected := CASE WHEN sess.pending_gingerbread_id IS NOT NULL THEN 1 ELSE 0 END;
  ELSE
    expected := 0;
  END IF;

  SELECT count(DISTINCT a.actor_id)::int INTO got
  FROM public.game_actions AS a
  WHERE a.session_id = sess.id
    AND a.phase = sess.phase
    AND a.night_number = sess.night_number
    AND a.day_number = sess.day_number;

  twist_window := CASE
    WHEN sess.phase = 'twist' THEN coalesce(sess.reveal_mode, 'post_morning')
    ELSE NULL
  END;

  payload := payload || jsonb_build_object(
    'ok', true,
    'isHost', true,
    'phase', sess.phase,
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
    'revealScript', CASE WHEN sess.phase = 'reveal' THEN sess.reveal_script ELSE NULL END,
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
      ELSIF NOT used OR sess.blizzard_night = sess.night_number THEN
        -- Keep Town Hall after an active Blizzard, even with no powers left.
        UPDATE public.game_sessions SET phase = 'twist', reveal_mode = 'post_morning', updated_at = now() WHERE id = sess.id;
      ELSE
        UPDATE public.game_sessions SET phase = 'day', day_number = night_number, updated_at = now() WHERE id = sess.id;
      END IF;
    ELSIF sess.reveal_mode = 'twist' THEN
      UPDATE public.game_sessions SET phase = 'day', day_number = night_number, updated_at = now() WHERE id = sess.id;
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
