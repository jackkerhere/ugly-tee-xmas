-- Party-night fixes: close a stalled turn, drop the dead ghost-prediction bonus,
-- official rehearsal mode, private Grinch/Krampus notices, Concertorant winner
-- copy, Night 1 intro, current lives on the player card, and a shorter
-- per-guest PIN lockout the host can clear.

ALTER TABLE public.game_sessions
  ADD COLUMN IF NOT EXISTS grinch_split_night integer,
  ADD COLUMN IF NOT EXISTS krampus_hit_note text,
  ADD COLUMN IF NOT EXISTS krampus_hit_night integer;

ALTER TABLE public.pin_lockouts
  ADD COLUMN IF NOT EXISTS guest_id uuid;

TRUNCATE public.pin_lockouts;

ALTER TABLE public.pin_lockouts
  ALTER COLUMN guest_id SET NOT NULL;

ALTER TABLE public.pin_lockouts
  DROP CONSTRAINT IF EXISTS pin_lockouts_pkey;

ALTER TABLE public.pin_lockouts
  ADD CONSTRAINT pin_lockouts_pkey PRIMARY KEY (fingerprint, guest_id);

ALTER TABLE public.pin_lockouts
  DROP CONSTRAINT IF EXISTS pin_lockouts_guest_id_fkey;

ALTER TABLE public.pin_lockouts
  ADD CONSTRAINT pin_lockouts_guest_id_fkey
  FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;

-- Issue 3 / reconnect: only show rehearsal names while a test lobby is current.
CREATE OR REPLACE FUNCTION private.list_guests_public()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'ok', true,
    'rehearsal', coalesce((SELECT s.is_test FROM public.game_sessions AS s WHERE s.is_current), false),
    'guests', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'display_name', s.display_name,
        'claimed', s.claimed,
        'is_test', s.is_test
      ) ORDER BY s.is_test, s.display_name)
      FROM (
        SELECT g.id, g.display_name, (g.pin_hash IS NOT NULL) AS claimed, g.is_test
        FROM public.guests AS g
        WHERE NOT g.is_demo
          AND (
            (g.display_name = 'Jack' AND NOT g.is_test)
            OR g.is_test = coalesce((SELECT s.is_test FROM public.game_sessions AS s WHERE s.is_current), false)
          )
      ) AS s
    ), '[]'::jsonb)
  );
$function$;

-- Issue 3: test elves may join only a rehearsal lobby.
CREATE OR REPLACE FUNCTION private.game_lobby_guest(p_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT g.id
  FROM private.guest_by_token(p_token) AS g
  WHERE NOT g.is_demo
    AND (
      NOT g.is_test
      OR coalesce((SELECT s.is_test FROM public.game_sessions AS s WHERE s.is_current), false)
    );
$function$;

CREATE OR REPLACE FUNCTION private.game_lobby_payload(p_session public.game_sessions, p_guest_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'ok', true,
    'phase', CASE WHEN p_session.phase = 'gingerbread' THEN 'reveal'
      ELSE coalesce(p_session.phase, 'not_started')
    END,
    'open', coalesce(p_session.phase, 'not_started') IN ('not_started', 'setup'),
    'rehearsal', coalesce(p_session.is_test, false),
    'joined', coalesce(bool_or(l.guest_id = p_guest_id), false),
    'count', count(*)::int,
    'isHost', (p_guest_id = private.game_designated_host()) IS TRUE,
    'minPlayers', 5,
    'maxPlayers', 15
  )
  FROM private.game_lobby_roster(p_session) AS l;
$function$;

CREATE OR REPLACE FUNCTION private.game_lobby_set(p_token text, p_joining boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  lobby_guest_id uuid := private.game_lobby_guest(p_token);
  sess public.game_sessions%ROWTYPE;
  guest_is_test boolean;
BEGIN
  IF lobby_guest_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not-found', 'message', 'Sign in to join the game.');
  END IF;
  IF lobby_guest_id = private.game_designated_host() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'The host does not join the player lobby.');
  END IF;
  IF p_joining IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Choose Join or Leave.');
  END IF;

  SELECT s.* INTO sess FROM public.game_sessions AS s WHERE s.is_current FOR UPDATE;
  IF sess.id IS NULL THEN
    INSERT INTO public.game_sessions (is_current, phase)
    VALUES (true, 'not_started')
    ON CONFLICT DO NOTHING;
    SELECT s.* INTO sess FROM public.game_sessions AS s WHERE s.is_current FOR UPDATE;
  END IF;

  IF sess.id IS NULL OR sess.phase NOT IN ('not_started', 'setup') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed', 'message', 'The lobby is closed for this game.');
  END IF;

  SELECT g.is_test INTO guest_is_test FROM public.guests AS g WHERE g.id = lobby_guest_id;
  IF p_joining AND coalesce(guest_is_test, false) IS DISTINCT FROM coalesce(sess.is_test, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'closed',
      'message', CASE WHEN sess.is_test
        THEN 'This is a rehearsal lobby. Sign in as a test elf.'
        ELSE 'The party lobby is for the guest list only.'
      END
    );
  END IF;

  IF p_joining THEN
    IF NOT EXISTS (
      SELECT FROM private.game_lobby_players AS l
      WHERE l.session_id = sess.id AND l.guest_id = lobby_guest_id
    ) THEN
      IF (SELECT count(*) FROM private.game_lobby_players AS l WHERE l.session_id = sess.id) >= 15 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'full', 'message', 'The lobby already has 15 players.');
      END IF;

      INSERT INTO private.game_lobby_players (session_id, guest_id)
      VALUES (sess.id, lobby_guest_id)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    DELETE FROM private.game_lobby_players AS l
    WHERE l.session_id = sess.id AND l.guest_id = lobby_guest_id;
  END IF;

  RETURN private.game_lobby_payload(sess, lobby_guest_id);
END;
$function$;

-- Issue 3: Jack can claim a rehearsal session.
CREATE OR REPLACE FUNCTION private.game_claim_host(p_token text, p_host_pin text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  guest_id uuid;
  sess public.game_sessions%ROWTYPE;
  new_token text;
BEGIN
  guest_id := (private.guest_by_token(p_token)).id;
  IF guest_id IS NULL OR guest_id IS DISTINCT FROM private.game_designated_host() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Jack is the game host.');
  END IF;

  SELECT s.* INTO sess FROM public.game_sessions AS s WHERE s.is_current FOR UPDATE;
  IF sess.id IS NULL THEN
    INSERT INTO public.game_sessions (is_current, phase) VALUES (true, 'not_started')
      ON CONFLICT DO NOTHING;
    SELECT s.* INTO STRICT sess FROM public.game_sessions AS s WHERE s.is_current FOR UPDATE;
  END IF;

  IF sess.phase NOT IN ('not_started', 'setup') AND sess.host_guest_id IS DISTINCT FROM guest_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'A game is already in progress.');
  END IF;

  new_token := CASE WHEN sess.host_guest_id = guest_id THEN sess.host_token END;
  IF new_token IS NULL THEN
    new_token := encode(extensions.gen_random_bytes(32), 'hex');
    UPDATE public.game_sessions
    SET host_guest_id = guest_id,
        host_token = new_token,
        phase = CASE WHEN phase = 'not_started' THEN 'setup' ELSE phase END,
        updated_at = now()
    WHERE id = sess.id
    RETURNING * INTO sess;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'hostToken', new_token,
    'phase', sess.phase,
    'hostName', 'Jack',
    'rehearsal', coalesce(sess.is_test, false)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_host_by_token(p_host_token text)
RETURNS public.game_sessions
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT s.* FROM public.game_sessions AS s
  WHERE s.is_current
    AND s.host_guest_id = private.game_designated_host()
    AND s.host_token = btrim(p_host_token)
    AND length(btrim(p_host_token)) >= 16;
$function$;

-- Reconnect: shorter, per-guest lockout.
CREATE OR REPLACE FUNCTION private.login_with_pin(guest_id uuid, pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  fp text;
  digits text;
  lock public.pin_lockouts%ROWTYPE;
  found public.guests%ROWTYPE;
  now_ts timestamptz := clock_timestamp();
BEGIN
  fp := private.client_fingerprint();
  digits := regexp_replace(coalesce(pin, ''), '\D', '', 'g');

  IF login_with_pin.guest_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'invalid',
      'message', 'Choose your name, then enter your PIN.'
    );
  END IF;

  INSERT INTO public.pin_lockouts (fingerprint, guest_id, fail_count, updated_at)
  VALUES (fp, login_with_pin.guest_id, 0, now_ts)
  ON CONFLICT ON CONSTRAINT pin_lockouts_pkey DO NOTHING;

  SELECT * INTO lock
  FROM public.pin_lockouts
  WHERE fingerprint = fp AND pin_lockouts.guest_id = login_with_pin.guest_id
  FOR UPDATE;

  IF lock.locked_until IS NOT NULL AND lock.locked_until > now_ts THEN
    INSERT INTO public.pin_attempts (fingerprint, attempted_at, success) VALUES (fp, now_ts, false);
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'locked',
      'lockedUntil', lock.locked_until,
      'message', 'Too many tries. Please wait a minute and try again, or ask the host to clear the lockout.'
    );
  END IF;

  IF lock.locked_until IS NOT NULL AND lock.locked_until <= now_ts THEN
    UPDATE public.pin_lockouts
    SET fail_count = 0, locked_until = NULL, updated_at = now_ts
    WHERE fingerprint = fp AND pin_lockouts.guest_id = login_with_pin.guest_id;
    lock.fail_count := 0;
    lock.locked_until := NULL;
  END IF;

  IF length(digits) = 6 THEN
    SELECT g.* INTO found
    FROM public.guests AS g
    WHERE g.id = login_with_pin.guest_id
      AND g.pin_hash IS NOT NULL
      AND g.pin_hash = extensions.crypt(digits, g.pin_hash);
  END IF;

  IF found.id IS NOT NULL THEN
    INSERT INTO public.pin_attempts (fingerprint, attempted_at, success) VALUES (fp, now_ts, true);
    UPDATE public.pin_lockouts
    SET fail_count = 0, locked_until = NULL, updated_at = now_ts
    WHERE fingerprint = fp AND pin_lockouts.guest_id = login_with_pin.guest_id;
    RETURN jsonb_build_object('ok', true, 'token', found.token);
  END IF;

  INSERT INTO public.pin_attempts (fingerprint, attempted_at, success) VALUES (fp, now_ts, false);
  UPDATE public.pin_lockouts
  SET fail_count = lock.fail_count + 1,
      locked_until = CASE WHEN lock.fail_count + 1 >= 5 THEN now_ts + interval '90 seconds' ELSE NULL END,
      updated_at = now_ts
  WHERE fingerprint = fp AND pin_lockouts.guest_id = login_with_pin.guest_id;

  IF lock.fail_count + 1 >= 5 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'locked',
      'lockedUntil', now_ts + interval '90 seconds',
      'message', 'Too many tries. Please wait a minute and try again, or ask the host to clear the lockout.'
    );
  END IF;

  IF EXISTS (SELECT 1 FROM public.guests AS g WHERE g.id = login_with_pin.guest_id AND g.pin_hash IS NULL) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'unclaimed',
      'message', 'That name hasn’t been claimed yet. Create your PIN first.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'reason', 'invalid',
    'message', 'That PIN didn’t work. Please try again.'
  );
END;
$function$;

-- Issue 11: Start Night 1 plays the intro first.
CREATE OR REPLACE FUNCTION private.game_host_start(p_host_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  n int;
BEGIN
  sess := private.game_lock_host_session(p_host_token);
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Host login required.');
  END IF;
  IF sess.phase IS DISTINCT FROM 'shuffled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Shuffle roles first, then start Night 1.');
  END IF;
  SELECT count(*) INTO n FROM public.game_players AS p WHERE p.session_id = sess.id;
  IF n < 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Shuffle roles first.');
  END IF;

  PERFORM private.game_start_reveal(sess.id, 'intro', private.game_intro_scenes(sess.id));
  RETURN private.game_host_state(p_host_token);
END;
$function$;

-- Issue 6: ghosts count toward night readiness.
CREATE OR REPLACE FUNCTION private.game_turn_readiness(p_sess public.game_sessions)
RETURNS TABLE(expected integer, submitted integer)
LANGUAGE sql
STABLE
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
      AND CASE
        WHEN p_sess.phase = 'night' AND p.alive THEN
          a.action IN ('steal', 'krampus_steal', 'save', 'guard', 'check', 'cocoa', 'coal', 'watch', 'skip')
        WHEN p_sess.phase = 'night' AND NOT p.alive THEN
          a.action IN ('clue', 'haunt', 'shot', 'skip')
        WHEN p_sess.phase = 'day' THEN a.action = 'vote'
        WHEN p_sess.phase = 'gingerbread' THEN a.action = 'gingerbread'
        ELSE false
      END
  ))::int
  FROM public.game_players AS p
  WHERE p.session_id = p_sess.id
    AND (
      (p_sess.phase = 'night')
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

-- Issue 2: Predict is gone; do not award a leftover bonus.
CREATE OR REPLACE FUNCTION private.game_finish_predictions(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.game_sessions
  SET ghosts_bonus = false, updated_at = now()
  WHERE id = p_session_id;
END;
$function$;

-- Issue 9: Concertorants, not "nice". Issue 2/8: drop leftover winner lines.
CREATE OR REPLACE FUNCTION private.game_public_payload(p_sess public.game_sessions)
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
      'winnerSide', NULL,
      'snowmanWon', false,
      'reveal', jsonb_build_object('active', false),
      'title', 'Who Stole Christmas?',
      'rehearsal', false
    );
  END IF;

  reveal := private.game_visible_reveal(p_sess);
  town_hall_pending := p_sess.phase = 'day' AND p_sess.town_hall_ends_at > statement_timestamp();
  winner_is_public := p_sess.phase = 'ended' OR coalesce(reveal->'current'->>'kind' = 'winner', false);

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
    winner_text := 'The Concertorants win! Every Grinch and Krampus is out.';
  ELSIF p_sess.winner_side = 'grinches' THEN
    winner_text := 'The Grinches win! There are at least as many living Grinches as everyone else still alive.';
  ELSIF p_sess.winner_side = 'no_team' THEN
    winner_text := 'No team won the round.';
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
    'hauntedName', NULL,
    'leakedInnocentName', CASE WHEN p_sess.leaked_innocent_id IS NOT NULL
      THEN private.game_guest_name(p_sess.leaked_innocent_id) ELSE NULL END,
    'winnerSide', CASE WHEN winner_is_public THEN p_sess.winner_side END,
    'winnerText', CASE WHEN winner_is_public THEN winner_text END,
    'snowmanWon', p_sess.phase = 'ended' AND p_sess.snowman_won,
    'ghostsBonus', false,
    'activeTwist', p_sess.active_twist,
    'title', 'Who Stole Christmas?',
    'rehearsal', coalesce(p_sess.is_test, false),
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

-- Issues 7 and 8: private notices when Grinches split or a Krampus hit lands.
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
  steal_count integer := 0;
  steal_distinct integer := 0;
  split_grinches boolean := false;
  krampus_result text;
  krampus_note text;
BEGIN
  SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = p_session_id FOR UPDATE;
  blizzard := (sess.blizzard_night IS NOT NULL AND sess.blizzard_night = sess.night_number);

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
    krampus_note := 'Tonight was a Blizzard. Your hit did not land.';
  ELSE
    SELECT count(*), count(DISTINCT a.target_id)
    INTO steal_count, steal_distinct
    FROM public.game_actions AS a
    WHERE a.session_id = p_session_id
      AND a.phase = 'night'
      AND a.night_number = sess.night_number
      AND a.action = 'steal';
    split_grinches := steal_count >= 2 AND steal_distinct > 1;

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
        IF rec.gid = krampus_of THEN
          krampus_result := result;
        END IF;
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

    IF krampus_of IS NULL THEN
      krampus_note := 'You did not take a shot tonight.';
    ELSIF steal_of IS NOT NULL AND krampus_of = steal_of THEN
      krampus_note := 'Your target was also stolen from by the Grinches, so this did not count as your personal hit.';
    ELSIF krampus_result = 'out' THEN
      krampus_note := 'Your hit counted. They are out.';
    ELSIF krampus_result = 'wounded' THEN
      krampus_note := 'Your hit counted. They lost a life.';
    ELSIF krampus_result = 'saved' THEN
      krampus_note := 'Your hit did not count. Someone saved them.';
    ELSE
      krampus_note := 'Your hit did not count tonight.';
    END IF;
  END IF;

  UPDATE public.game_players
  SET last_santa_target_id = save_of
  WHERE session_id = p_session_id AND role = 'santa'
    AND last_santa_target_id IS DISTINCT FROM save_of;

  PERFORM private.game_check_win(p_session_id);
  PERFORM private.game_finish_predictions(p_session_id);

  UPDATE public.game_sessions
  SET announcement = NULL,
      grinch_split_night = CASE WHEN split_grinches THEN sess.night_number ELSE NULL END,
      krampus_hit_note = krampus_note,
      krampus_hit_night = CASE WHEN krampus_note IS NOT NULL THEN sess.night_number ELSE NULL END,
      updated_at = now()
  WHERE id = p_session_id;

  RETURN scenes;
END;
$function$;

-- Reconnect: current lives on the card. Issues 7–8: private notices.
CREATE OR REPLACE FUNCTION private.game_me(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  me public.guests%ROWTYPE;
  sess public.game_sessions%ROWTYPE;
  pl public.game_players%ROWTYPE;
  payload jsonb;
  fellows jsonb := '[]'::jsonb;
  witness_name text;
  night_action text;
  locked boolean := false;
  check_obj jsonb;
  living jsonb;
  dead jsonb;
  submitted_actions text[] := ARRAY[]::text[];
  is_revenge_player boolean := false;
  public_alive boolean;
  you_obj jsonb;
BEGIN
  me := private.guest_by_token(p_token);
  IF me.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not-found');
  END IF;
  sess := private.game_current();
  payload := private.game_public_payload(sess) || jsonb_build_object('ghostShot', false);

  IF sess.id IS NOT NULL AND sess.host_guest_id = me.id THEN
    payload := payload || jsonb_build_object(
      'ok', true,
      'isHost', true,
      'isPlayer', false,
      'you', jsonb_build_object('id', me.id, 'display_name', me.display_name)
    );
    RETURN payload;
  END IF;

  IF sess.id IS NULL THEN
    payload := payload || jsonb_build_object(
      'ok', true,
      'isHost', false,
      'isPlayer', false,
      'you', jsonb_build_object('id', me.id, 'display_name', me.display_name)
    );
    RETURN payload;
  END IF;

  SELECT * INTO pl
  FROM public.game_players AS p
  WHERE p.session_id = sess.id AND p.guest_id = me.id;

  IF NOT FOUND THEN
    payload := payload || jsonb_build_object(
      'ok', true,
      'isHost', false,
      'isPlayer', false,
      'you', jsonb_build_object('id', me.id, 'display_name', me.display_name)
    );
    RETURN payload;
  END IF;

  is_revenge_player := sess.phase = 'gingerbread' AND sess.pending_gingerbread_id = me.id;
  SELECT coalesce((guest->>'alive')::boolean, pl.alive)
  INTO public_alive
  FROM jsonb_array_elements(payload->'players') AS public_players(guest)
  WHERE guest->>'id' = me.id::text;

  IF private.game_is_grinch(pl.role) THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id,
      'display_name', g.display_name
    ) ORDER BY g.display_name), '[]'::jsonb)
    INTO fellows
    FROM public.game_players AS p
    JOIN public.guests AS g ON g.id = p.guest_id
    WHERE p.session_id = sess.id
      AND private.game_is_grinch(p.role)
      AND p.guest_id IS DISTINCT FROM me.id;
  END IF;

  IF pl.role = 'witness' AND sess.witness_of IS NOT NULL
     AND (sess.night_number >= 1 OR sess.phase NOT IN ('shuffled','setup','not_started')) THEN
    witness_name := private.game_guest_name(sess.witness_of);
  END IF;

  IF pl.role = 'detective' AND sess.phase IN ('morning','day','ended','gingerbread','reveal','twist')
     AND pl.last_check_target_id IS NOT NULL THEN
    check_obj := jsonb_build_object(
      'targetName', private.game_guest_name(pl.last_check_target_id),
      'isBad', pl.last_check_is_bad
    );
  END IF;

  SELECT coalesce(array_agg(a.action), ARRAY[]::text[])
  INTO submitted_actions
  FROM public.game_actions AS a
  WHERE a.session_id = sess.id
    AND a.actor_id = me.id
    AND a.phase = sess.phase
    AND a.night_number = sess.night_number
    AND a.day_number = sess.day_number;

  locked := coalesce(array_length(submitted_actions, 1), 0) > 0
            OR (sess.phase = 'night' AND pl.alive AND EXISTS (
              SELECT 1 FROM public.game_actions AS a
              WHERE a.session_id = sess.id AND a.actor_id = me.id
                AND a.phase = 'night' AND a.night_number = sess.night_number
            ));

  IF pl.role IN ('grinch','tough_grinch') THEN night_action := 'steal';
  ELSIF pl.role = 'krampus' THEN night_action := 'krampus_steal';
  ELSIF pl.role = 'santa' THEN night_action := 'save';
  ELSIF pl.role = 'reindeer' THEN night_action := 'guard';
  ELSIF pl.role = 'detective' THEN night_action := 'check';
  ELSIF pl.role = 'mrs_claus' THEN night_action := 'item';
  ELSE night_action := 'watch';
  END IF;

  IF is_revenge_player THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'display_name', g.display_name
    ) ORDER BY g.display_name), '[]'::jsonb)
    INTO living
    FROM public.game_players AS p
    JOIN public.guests AS g ON g.id = p.guest_id
    WHERE p.session_id = sess.id AND p.alive;
  ELSE
    SELECT coalesce(jsonb_agg(guest - 'alive' ORDER BY guest->>'display_name')
      FILTER (WHERE (guest->>'alive')::boolean), '[]'::jsonb)
    INTO living
    FROM jsonb_array_elements(payload->'players') AS public_players(guest);
  END IF;

  SELECT coalesce(jsonb_agg(guest - 'alive' ORDER BY guest->>'display_name')
    FILTER (WHERE NOT (guest->>'alive')::boolean), '[]'::jsonb)
  INTO dead
  FROM jsonb_array_elements(payload->'players') AS public_players(guest);

  you_obj := jsonb_build_object(
    'id', me.id,
    'display_name', me.display_name,
    'role', pl.role,
    'roleName', private.game_role_name(pl.role),
    'ability', private.game_role_ability(pl.role),
    'alive', CASE WHEN is_revenge_player THEN pl.alive ELSE coalesce(public_alive, pl.alive) END,
    'lives', pl.lives,
    'livesMax', pl.lives_max,
    'nightAction', night_action,
    'cocoaUsed', pl.cocoa_used,
    'coalUsed', pl.coal_used,
    'lastSantaTargetId', pl.last_santa_target_id,
    'prediction', pl.prediction,
    'blockedSaveId', pl.last_santa_target_id,
    'isHaunted', sess.haunted_guest_id = me.id AND sess.phase IN ('morning','day','reveal','twist'),
    'isHungover', sess.hangover_guest_id = me.id AND sess.phase IN ('morning','day','reveal','twist')
  );

  payload := payload || jsonb_build_object(
    'ok', true,
    'isHost', false,
    'isPlayer', true,
    'phase', CASE WHEN is_revenge_player THEN sess.phase ELSE payload->>'phase' END,
    'you', you_obj,
    'fellowGrinches', fellows,
    'witnessGrinchName', witness_name,
    'detectiveResult', check_obj,
    'living', living,
    'dead', dead,
    'submitted', submitted_actions,
    'locked', locked,
    'pendingGingerbread', is_revenge_player,
    'possessAvailable', false
  );
  IF private.game_is_grinch(pl.role)
     AND sess.grinch_split_night IS NOT DISTINCT FROM sess.night_number
     AND sess.phase IS DISTINCT FROM 'night' THEN
    payload := payload || jsonb_build_object('privateNotice', 'The Grinches could not agree.');
  END IF;
  IF pl.role = 'krampus'
     AND sess.krampus_hit_night IS NOT DISTINCT FROM sess.night_number
     AND sess.phase IS DISTINCT FROM 'night'
     AND NULLIF(sess.krampus_hit_note, '') IS NOT NULL THEN
    payload := payload || jsonb_build_object('krampusNotice', sess.krampus_hit_note);
  END IF;
  IF pl.role = 'krampus' AND EXISTS (
    SELECT 1
    FROM private.game_krampus_eliminations AS e
    WHERE e.session_id = sess.id
      AND (
        e.night_number < sess.night_number
        OR (
          sess.phase <> 'night'
          AND (sess.phase NOT IN ('reveal', 'gingerbread')
               OR sess.reveal_mode NOT IN ('night', 'gingerbread'))
        )
      )
    GROUP BY e.session_id
    HAVING count(*) = 2
  ) THEN
    payload := payload || jsonb_build_object('krampusWon', true);
  END IF;
  IF sess.phase = 'day' OR (sess.phase = 'twist' AND sess.reveal_mode = 'post_morning') THEN
    IF NOT pl.alive AND NULLIF(sess.ghost_clue, '') IS NOT NULL THEN
      payload := payload || jsonb_build_object('ghostClue', sess.ghost_clue);
    END IF;
    IF pl.alive AND EXISTS (
      SELECT 1 FROM private.game_ghost_shots AS s
      WHERE s.session_id = sess.id AND s.night_number = sess.night_number AND s.guest_id = me.id
    ) THEN
      payload := payload || jsonb_build_object('ghostShot', true);
    END IF;
  END IF;
  RETURN payload;
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
  waiting jsonb := '[]'::jsonb;
  waiting_ghosts jsonb := '[]'::jsonb;
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

  IF sess.phase = 'night' THEN
    SELECT coalesce(jsonb_agg(g.display_name ORDER BY g.display_name) FILTER (WHERE p.alive), '[]'::jsonb),
           coalesce(jsonb_agg(g.display_name ORDER BY g.display_name) FILTER (WHERE NOT p.alive), '[]'::jsonb)
    INTO waiting, waiting_ghosts
    FROM public.game_players AS p
    JOIN public.guests AS g ON g.id = p.guest_id
    WHERE p.session_id = sess.id
      AND NOT EXISTS (
        SELECT 1 FROM public.game_actions AS a
        WHERE a.session_id = sess.id
          AND a.actor_id = p.guest_id
          AND a.phase = 'night'
          AND a.night_number = sess.night_number
          AND a.day_number = sess.day_number
          AND (
            (p.alive AND a.action IN ('steal', 'krampus_steal', 'save', 'guard', 'check', 'cocoa', 'coal', 'watch', 'skip'))
            OR (NOT p.alive AND a.action IN ('clue', 'haunt', 'shot', 'skip'))
          )
      );
  ELSIF sess.phase = 'day' THEN
    SELECT coalesce(jsonb_agg(g.display_name ORDER BY g.display_name), '[]'::jsonb)
    INTO waiting
    FROM public.game_players AS p
    JOIN public.guests AS g ON g.id = p.guest_id
    WHERE p.session_id = sess.id
      AND p.alive
      AND p.guest_id IS DISTINCT FROM sess.haunted_guest_id
      AND p.guest_id IS DISTINCT FROM sess.hangover_guest_id
      AND p.guest_id IS DISTINCT FROM (SELECT private.game_possessed_voter(sess))
      AND NOT EXISTS (
        SELECT 1 FROM public.game_actions AS a
        WHERE a.session_id = sess.id
          AND a.actor_id = p.guest_id
          AND a.phase = 'day'
          AND a.night_number = sess.night_number
          AND a.day_number = sess.day_number
          AND a.action = 'vote'
      );
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
    'ghostsBonus', false,
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
    'waitingNames', waiting,
    'waitingGhostNames', waiting_ghosts,
    'canAdvance', CASE
      WHEN sess.phase IN ('night', 'day', 'gingerbread') THEN got >= expected AND payload->>'phase' <> 'town_hall'
      ELSE sess.phase = 'reveal'
    END,
    'canCloseTurn', sess.phase IN ('night', 'day') AND payload->>'phase' <> 'town_hall',
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
    ),
    'rehearsal', coalesce(sess.is_test, false),
    'rehearsalPin', CASE WHEN sess.is_test THEN '482917' ELSE NULL END,
    'canOpenRehearsal', NOT coalesce(sess.is_test, false),
    'canOpenParty', coalesce(sess.is_test, false)
  );
  RETURN payload;
END;
$function$;

-- Issue 1: close a stalled night or vote.
CREATE OR REPLACE FUNCTION private.game_host_close_turn(p_host_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  night_scenes jsonb;
  vote_scenes jsonb;
BEGIN
  sess := private.game_lock_host_session(p_host_token);
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Host login required.');
  END IF;
  IF sess.phase = 'day' AND sess.town_hall_ends_at > statement_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'message', 'Town Hall is still in progress.');
  END IF;
  IF sess.phase NOT IN ('night', 'day') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Close a night or a vote that is still open.');
  END IF;

  IF sess.phase = 'night' THEN
    INSERT INTO public.game_actions (
      session_id, night_number, day_number, phase, actor_id, action, target_id, extra_id, extra_text
    )
    SELECT sess.id, sess.night_number, sess.day_number, 'night', p.guest_id, 'watch', NULL, NULL, NULL
    FROM public.game_players AS p
    WHERE p.session_id = sess.id
      AND p.alive
      AND NOT EXISTS (
        SELECT 1 FROM public.game_actions AS a
        WHERE a.session_id = sess.id
          AND a.actor_id = p.guest_id
          AND a.phase = 'night'
          AND a.night_number = sess.night_number
          AND a.day_number = sess.day_number
          AND a.action IN ('steal', 'krampus_steal', 'save', 'guard', 'check', 'cocoa', 'coal', 'watch', 'skip')
      );

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
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_host_clear_pin_lockouts(p_host_token text)
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
  DELETE FROM public.pin_lockouts;
  RETURN private.game_host_state(p_host_token) || jsonb_build_object('clearedLockouts', true);
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_ensure_rehearsal_elves()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  i integer;
  v_name text;
  gid uuid;
  sess_id uuid;
BEGIN
  SELECT s.id INTO sess_id FROM public.game_sessions AS s WHERE s.is_current;
  IF sess_id IS NULL THEN
    RETURN;
  END IF;

  FOR i IN 1..13 LOOP
    v_name := 'QA Elf ' || lpad(i::text, 2, '0');
    SELECT g.id INTO gid
    FROM public.guests AS g
    WHERE g.is_test AND NOT g.is_demo AND g.display_name = v_name
    LIMIT 1;
    IF gid IS NULL THEN
      INSERT INTO public.guests (display_name, token, pin_hash, is_test, is_demo)
      VALUES (
        v_name,
        encode(extensions.gen_random_bytes(32), 'hex'),
        extensions.crypt('482917', extensions.gen_salt('bf')),
        true,
        false
      )
      RETURNING id INTO gid;
    ELSE
      UPDATE public.guests
      SET pin_hash = extensions.crypt('482917', extensions.gen_salt('bf'))
      WHERE id = gid;
    END IF;

    INSERT INTO private.game_lobby_players (session_id, guest_id)
    VALUES (sess_id, gid)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_host_open_rehearsal(p_host_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  host_id uuid := private.game_designated_host();
BEGIN
  sess := private.game_lock_host_session(p_host_token);
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Host login required.');
  END IF;

  PERFORM private.game_reset(true);
  UPDATE public.game_sessions
  SET host_guest_id = host_id,
      host_token = btrim(p_host_token),
      phase = 'setup',
      updated_at = now()
  WHERE is_current;

  PERFORM private.game_ensure_rehearsal_elves();
  RETURN private.game_host_state(p_host_token);
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_host_open_party(p_host_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  host_id uuid := private.game_designated_host();
BEGIN
  sess := private.game_lock_host_session(p_host_token);
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Host login required.');
  END IF;

  PERFORM private.game_reset(false);
  UPDATE public.game_sessions
  SET host_guest_id = host_id,
      host_token = btrim(p_host_token),
      phase = 'setup',
      updated_at = now()
  WHERE is_current;

  RETURN private.game_host_state(p_host_token);
END;
$function$;


-- Keep the host signed in when opening a new lobby, and reseat test elves in rehearsal.
CREATE OR REPLACE FUNCTION private.game_host_reset(p_host_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  was_test boolean;
BEGIN
  sess := private.game_lock_host_session(p_host_token);
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', 'Host login required.');
  END IF;
  was_test := coalesce(sess.is_test, false);
  PERFORM private.game_reset(was_test);
  UPDATE public.game_sessions
  SET host_guest_id = private.game_designated_host(),
      host_token = btrim(p_host_token),
      phase = 'setup',
      updated_at = now()
  WHERE is_current;
  IF was_test THEN
    PERFORM private.game_ensure_rehearsal_elves();
  END IF;
  RETURN private.game_host_state(p_host_token);
END;
$function$;

CREATE FUNCTION public.game_host_close_turn(host_token text)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.game_host_close_turn(host_token);
$function$;

CREATE FUNCTION public.game_host_clear_pin_lockouts(host_token text)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.game_host_clear_pin_lockouts(host_token);
$function$;

CREATE FUNCTION public.game_host_open_rehearsal(host_token text)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.game_host_open_rehearsal(host_token);
$function$;

CREATE FUNCTION public.game_host_open_party(host_token text)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.game_host_open_party(host_token);
$function$;

REVOKE ALL ON FUNCTION
  private.game_ensure_rehearsal_elves(),
  private.game_host_close_turn(text),
  public.game_host_close_turn(text),
  private.game_host_clear_pin_lockouts(text),
  public.game_host_clear_pin_lockouts(text),
  private.game_host_open_rehearsal(text),
  public.game_host_open_rehearsal(text),
  private.game_host_open_party(text),
  public.game_host_open_party(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  private.game_host_close_turn(text),
  public.game_host_close_turn(text),
  private.game_host_clear_pin_lockouts(text),
  public.game_host_clear_pin_lockouts(text),
  private.game_host_open_rehearsal(text),
  public.game_host_open_rehearsal(text),
  private.game_host_open_party(text),
  public.game_host_open_party(text)
TO anon, authenticated;
