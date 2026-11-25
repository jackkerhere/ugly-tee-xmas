-- Forecast one Host action from an authenticated snapshot. The preview uses
-- the public TV projection and never writes to the game.
CREATE FUNCTION private.game_next_reveal_state(p_sess public.game_sessions)
RETURNS public.game_sessions
LANGUAGE plpgsql IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  scenes jsonb := private.game_reveal_scenes(p_sess.reveal_script);
  beat_count integer := jsonb_array_length(private.game_reveal_beats(scenes->p_sess.reveal_scene));
BEGIN
  IF p_sess.reveal_beat + 1 < beat_count THEN
    p_sess.reveal_beat := p_sess.reveal_beat + 1;
    RETURN p_sess;
  ELSIF p_sess.reveal_scene + 1 < jsonb_array_length(scenes) THEN
    p_sess.reveal_scene := p_sess.reveal_scene + 1;
    p_sess.reveal_beat := 0;
    RETURN p_sess;
  END IF;

  IF p_sess.reveal_mode = 'intro' THEN
    p_sess.phase := 'night';
    p_sess.night_number := 1;
  ELSIF p_sess.reveal_mode IN ('night', 'gingerbread') THEN
    IF p_sess.winner_side IS NOT NULL THEN
      p_sess.phase := 'ended';
    ELSE
      p_sess.phase := 'twist';
      p_sess.reveal_mode := 'post_morning';
    END IF;
  ELSIF p_sess.reveal_mode = 'twist' AND p_sess.day_number < p_sess.night_number THEN
    p_sess.phase := 'twist';
    p_sess.reveal_mode := 'post_morning';
  ELSIF p_sess.reveal_mode = 'recount' THEN
    p_sess.phase := 'day';
  ELSIF p_sess.reveal_mode = 'vote' THEN
    IF p_sess.winner_side IS NOT NULL THEN
      p_sess.phase := 'ended';
    ELSIF p_sess.twist_used_night IS DISTINCT FROM p_sess.night_number THEN
      p_sess.phase := 'twist';
      p_sess.reveal_mode := 'post_vote';
    ELSE
      p_sess.phase := 'night';
      p_sess.night_number := p_sess.night_number + 1;
      p_sess.ghost_clue := NULL;
    END IF;
  ELSE
    p_sess.phase := 'day';
    p_sess.day_number := p_sess.night_number;
  END IF;
  RETURN p_sess;
END;
$function$;

REVOKE ALL ON FUNCTION private.game_next_reveal_state(public.game_sessions) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.game_host_tv_preview(p_host_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  projected public.game_sessions%ROWTYPE;
  current_tv jsonb;
  next_tv jsonb;
  next_action text;
  next_screen text;
  exact_screen boolean := false;
BEGIN
  sess := private.game_host_by_token(p_host_token);
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Host login required.');
  END IF;

  current_tv := private.game_public_payload(sess);
  projected := sess;

  IF sess.phase = 'reveal' THEN
    next_action := 'advance';
    projected := private.game_next_reveal_state(sess);
    exact_screen := true;
  ELSIF sess.phase = 'shuffled' THEN
    next_action := 'start';
    projected.phase := 'night';
    projected.night_number := 1;
    projected.day_number := 0;
    exact_screen := true;
  ELSIF current_tv->>'phase' = 'town_hall' THEN
    next_action := 'wait';
    projected.town_hall_ends_at := NULL;
    exact_screen := true;
  ELSIF sess.phase = 'twist' AND sess.reveal_mode = 'post_morning' THEN
    next_action := 'start_town_hall';
    projected.phase := 'day';
    projected.day_number := sess.night_number;
    -- Start the preview at 3:30 without creating a real deadline.
    projected.town_hall_ends_at := statement_timestamp() + interval '3 minutes 30 seconds';
    exact_screen := true;
  ELSIF sess.phase = 'twist' AND sess.reveal_mode = 'post_vote' THEN
    next_action := 'skip_twist';
    projected.phase := 'night';
    projected.night_number := sess.night_number + 1;
    projected.ghost_clue := NULL;
    projected.active_twist := CASE WHEN sess.blizzard_night = projected.night_number THEN 'blizzard' END;
    exact_screen := true;
  ELSIF sess.phase IN ('night', 'day', 'gingerbread') THEN
    -- Resolution depends on actions and may produce a private reprisal.
    next_action := 'advance';
    next_screen := CASE
      WHEN sess.phase = 'day' OR (sess.phase = 'gingerbread' AND sess.reveal_mode = 'vote') THEN 'Vote results'
      ELSE 'Morning ' || (sess.night_number + 1) || ' reveal'
    END;
  END IF;

  IF exact_screen THEN
    next_tv := private.game_public_payload(projected);
    next_screen := CASE next_tv->>'phase'
      WHEN 'night' THEN 'Night ' || projected.night_number
      WHEN 'day' THEN 'Voting is open'
      WHEN 'town_hall' THEN 'Town Hall'
      WHEN 'twist' THEN CASE WHEN projected.reveal_mode = 'post_vote' THEN 'After the vote' ELSE 'Town Hall' END
      WHEN 'ended' THEN 'Game over'
      WHEN 'reveal' THEN CASE
        WHEN next_tv->'reveal'->'current'->>'kind' = 'winner' THEN 'Winner reveal'
        WHEN projected.reveal_mode = 'vote' AND projected.reveal_beat = 1
          AND (next_tv->'reveal'->'current') ? 'voteTally' THEN 'Vote tally'
        ELSE 'Next TV slide'
      END
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'from', jsonb_build_object(
      'phase', CASE WHEN sess.phase = 'gingerbread' THEN sess.phase ELSE current_tv->>'phase' END,
      'nightNumber', sess.night_number,
      'dayNumber', sess.day_number,
      'revealMode', sess.reveal_mode,
      'sceneIndex', CASE WHEN sess.phase = 'reveal' THEN sess.reveal_scene END,
      'beatIndex', CASE WHEN sess.phase = 'reveal' THEN sess.reveal_beat END
    ),
    'currentTv', current_tv,
    'nextAction', next_action,
    'nextScreen', next_screen,
    'tv', next_tv
  );
END;
$function$;

CREATE FUNCTION public.game_host_tv_preview(host_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.game_host_tv_preview(host_token);
$function$;

REVOKE ALL ON FUNCTION
  private.game_host_tv_preview(text), public.game_host_tv_preview(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  private.game_host_tv_preview(text), public.game_host_tv_preview(text)
TO anon, authenticated;

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
