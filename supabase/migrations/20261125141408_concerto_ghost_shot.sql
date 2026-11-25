-- Replace new Ghost possession and prediction submissions with a private
-- morning notice. Retain old action values so stored turns remain valid.
ALTER TABLE public.game_actions
  DROP CONSTRAINT game_actions_action_check,
  ADD CONSTRAINT game_actions_action_check CHECK (
    action IN (
      'watch', 'skip', 'steal', 'krampus_steal', 'save', 'guard', 'check',
      'cocoa', 'coal', 'vote', 'clue', 'haunt', 'shot', 'possess', 'predict', 'gingerbread'
    )
  );

CREATE TABLE private.game_ghost_shots (
  session_id uuid NOT NULL,
  night_number integer NOT NULL,
  guest_id uuid NOT NULL,
  PRIMARY KEY (session_id, night_number),
  FOREIGN KEY (session_id, guest_id)
    REFERENCES public.game_players (session_id, guest_id) ON DELETE CASCADE
);
ALTER TABLE private.game_ghost_shots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.game_ghost_shots FROM PUBLIC, anon, authenticated;

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

  IF act IN ('possess', 'predict') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'That Ghost action is no longer available.');
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
  IF act IN ('clue','haunt','shot') THEN
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
    SELECT * INTO tgt FROM public.game_players AS p
    WHERE p.session_id = sess.id AND p.guest_id = p_target AND p.alive;
    IF tgt.guest_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Pick someone still in the game.');
    END IF;
    RETURN private.game_lock_action(sess.id, 'night', sess.night_number, sess.day_number, me.id, act, p_target);
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

CREATE OR REPLACE FUNCTION private.game_resolve_ghosts(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  clue_of uuid;
  haunt_of uuid;
  shot_of uuid;
  cause text;
  clue_text text;
  pool text;
BEGIN
  SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = p_session_id;
  IF sess.phase IS DISTINCT FROM 'night' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.game_players AS p
    WHERE p.session_id = p_session_id AND NOT p.alive
  ) THEN
    RETURN;
  END IF;

  clue_of := private.game_majority_target(p_session_id, 'night', sess.night_number, sess.day_number, 'clue');
  haunt_of := private.game_majority_target(p_session_id, 'night', sess.night_number, sess.day_number, 'haunt');

  IF clue_of IS NOT NULL THEN
    SELECT p.death_cause INTO cause
    FROM public.game_players AS p
    WHERE p.session_id = p_session_id AND p.guest_id = clue_of AND NOT p.alive;
    IF cause IS NOT NULL THEN
      pool := CASE
        WHEN cause = 'grinch' THEN 'ghost_grinch'
        WHEN cause = 'krampus' THEN 'ghost_krampus'
        ELSE 'ghost_twist'
      END;
      clue_text := private.game_pick_line(p_session_id, pool, private.game_guest_name(clue_of));
    END IF;
  END IF;

  shot_of := private.game_majority_target(p_session_id, 'night', sess.night_number, sess.day_number, 'shot');
  IF shot_of IS NOT NULL THEN
    INSERT INTO private.game_ghost_shots (session_id, night_number, guest_id)
    VALUES (p_session_id, sess.night_number, shot_of)
    ON CONFLICT (session_id, night_number) DO NOTHING;
  END IF;

  UPDATE public.game_sessions
  SET ghost_clue = clue_text,
      haunted_guest_id = haunt_of,
      updated_at = now()
  WHERE id = p_session_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.game_resolve_ghosts(uuid) FROM PUBLIC, anon, authenticated;

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

  -- Witness is shown one Grinch from night 1, once the story has started.
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

  -- The player doing a private reprisal needs the actual living targets.
  -- Other phones follow the same staged roster as the TV.
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

  payload := payload || jsonb_build_object(
    'ok', true,
    'isHost', false,
    'isPlayer', true,
    'phase', CASE WHEN is_revenge_player THEN sess.phase ELSE payload->>'phase' END,
    'you', jsonb_build_object(
      'id', me.id,
      'display_name', me.display_name,
      'role', pl.role,
      'roleName', private.game_role_name(pl.role),
      'ability', private.game_role_ability(pl.role),
      'alive', CASE WHEN is_revenge_player THEN pl.alive ELSE coalesce(public_alive, pl.alive) END,
      'nightAction', night_action,
      'cocoaUsed', pl.cocoa_used,
      'coalUsed', pl.coal_used,
      'lastSantaTargetId', pl.last_santa_target_id,
      'prediction', pl.prediction,
      'blockedSaveId', pl.last_santa_target_id,
      'isHaunted', sess.haunted_guest_id = me.id AND sess.phase IN ('morning','day','reveal','twist'),
      'isHungover', sess.hangover_guest_id = me.id AND sess.phase IN ('morning','day','reveal','twist')
    ),
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
  -- These private notices open once the night reveal is complete.
  -- The Town Hall countdown and voting both use the stored day phase.
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
