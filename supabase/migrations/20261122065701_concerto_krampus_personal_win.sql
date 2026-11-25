-- Track Krampus's first credited elimination of each required category.
-- Only the private night resolver records these, after it applies an exclusive hit.
CREATE TABLE private.game_krampus_eliminations (
  session_id uuid NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
  target_side text NOT NULL CHECK (target_side IN ('grinches', 'nice')),
  night_number integer NOT NULL CHECK (night_number > 0),
  PRIMARY KEY (session_id, target_side)
);

ALTER TABLE private.game_krampus_eliminations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.game_krampus_eliminations FROM PUBLIC, anon, authenticated;

ALTER TABLE public.game_sessions
  DROP CONSTRAINT game_sessions_winner_check,
  ADD CONSTRAINT game_sessions_winner_check
    CHECK (winner_side IS NULL OR winner_side IN ('nice', 'grinches', 'krampus', 'no_team'));

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
  SELECT s.winner_side INTO already
  FROM public.game_sessions AS s
  WHERE s.id = p_session_id;

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

  IF n_alive = 1 AND n_krampus = 1 THEN
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

CREATE OR REPLACE FUNCTION private.game_winner_scene(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess public.game_sessions%ROWTYPE;
  beats text[] := ARRAY[]::text[];
  pool text;
BEGIN
  SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = p_session_id;
  IF sess.winner_side IS NULL THEN
    RETURN NULL;
  END IF;
  IF sess.winner_side = 'no_team' THEN
    beats := ARRAY['No team won the round.'];
  ELSE
    pool := CASE sess.winner_side
      WHEN 'nice' THEN 'win_nice'
      WHEN 'grinches' THEN 'win_grinches'
      WHEN 'krampus' THEN 'win_krampus'
    END;
    beats := array_append(beats, private.game_pick_line(p_session_id, pool));
  END IF;
  IF sess.ghosts_bonus IS TRUE OR (
    -- compute tentatively if already ended predictions
    sess.ghosts_bonus IS TRUE
  ) THEN
    beats := array_append(beats, private.game_pick_line(p_session_id, 'win_ghosts'));
  END IF;
  IF sess.snowman_won THEN
    beats := array_append(beats, 'Meanwhile the Snowman is still technically a winner, and would like that on a mug.');
  END IF;
  RETURN private.game_scene('winner', NULL, sess.winner_side, VARIADIC beats);
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

  -- Ghosts already resolved before this function in advance(); read current clue/haunt.
  SELECT * INTO sess FROM public.game_sessions AS s WHERE s.id = p_session_id;

  IF sess.ghost_clue IS NOT NULL AND length(sess.ghost_clue) > 0 THEN
    scenes := scenes || private.game_scene('clue', NULL, 'clue', VARIADIC ARRAY[sess.ghost_clue]);
  END IF;
  IF sess.haunted_guest_id IS NOT NULL THEN
    scenes := scenes || private.game_scene(
      'haunt', sess.haunted_guest_id, 'haunt',
      VARIADIC ARRAY[
        'A cold draft picks a favourite. ' || private.game_guest_name(sess.haunted_guest_id) ||
        ' is haunted, and cannot vote today. (The ghosts are insufferable about it.)'
      ]
    );
  END IF;

  PERFORM private.game_check_win(p_session_id);
  PERFORM private.game_finish_predictions(p_session_id);

  UPDATE public.game_sessions
  SET announcement = NULL, updated_at = now()
  WHERE id = p_session_id;

  RETURN scenes;
END;
$function$;

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
  clue_is_public boolean;
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
  clue_is_public := p_sess.phase <> 'gingerbread' AND (
    p_sess.phase <> 'reveal' OR p_sess.reveal_mode IS DISTINCT FROM 'night'
    OR coalesce(reveal->'current'->>'kind' = 'clue', false)
    OR coalesce(reveal->'history' @> '[{"kind":"clue"}]'::jsonb, false)
  );
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
    'phase', CASE WHEN p_sess.phase = 'gingerbread' THEN 'reveal' ELSE p_sess.phase END,
    'dealt', dealt,
    'nightNumber', p_sess.night_number,
    'dayNumber', p_sess.day_number,
    'players', players,
    'announcement', p_sess.announcement,
    'ghostClue', CASE WHEN clue_is_public THEN p_sess.ghost_clue END,
    'hauntedName', CASE WHEN p_sess.haunted_guest_id IS NOT NULL AND p_sess.phase IN ('morning','day','twist','reveal')
      THEN private.game_guest_name(p_sess.haunted_guest_id) ELSE NULL END,
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
  payload := private.game_public_payload(sess);

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
    'possessAvailable', NOT coalesce(public_alive, pl.alive) AND NOT sess.ghost_possess_used
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
  RETURN payload;
END;
$function$;

CREATE OR REPLACE FUNCTION private.game_role_ability(p_role text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_role
    WHEN 'grinch' THEN
      'You are a Grinch. Each night, you and the other Grinches steal one person together. You win when living Grinches are at least as many as everyone else still alive (Krampus counts as not a Grinch).'
    WHEN 'tough_grinch' THEN
      'You are a Tough Grinch — a Grinch with two lives. The Elf Detective sees you as bad. You steal with the other Grinches. You survive your first unsaved night hit and lose one life. If voted out in the morning, you become a ghost immediately. Your survival stays secret.'
    WHEN 'krampus' THEN
      'You hunt alone. Take out one Grinch (regular or Tough) and one Concertorant with your own unshared night hits to earn a personal win. The round keeps going. Your win counts even if you become a Ghost. The Elf Detective sees you as bad.'
    WHEN 'santa' THEN
      'Each night you may save one person, including yourself. You cannot save the same person two nights in a row.'
    WHEN 'reindeer' THEN
      'Each night you guard one person (not yourself). You may guard the same person every night. If they are stolen, they survive — but only if you also make it through that night. You are not taken down in their place.'
    WHEN 'detective' THEN
      'Each night you check one person. After the night, you will learn whether they are bad (a Grinch, Tough Grinch, or Krampus) or not.'
    WHEN 'mrs_claus' THEN
      'Once per game you may pour Hot Cocoa to save tonight’s victim or victims. Once per game you may give Coal to poison anyone. You may use only one item per night. Hot Cocoa can save you only on Night 1 or Night 2.'
    WHEN 'gingerbread' THEN
      'You have no night power while you are in the game. When you are out, you choose one player to take down with you.'
    WHEN 'fruitcake' THEN
      'You have two lives and no night power. You survive your first unsaved night hit and lose one life. If voted out in the morning, you become a ghost immediately. Your survival stays secret.'
    WHEN 'witness' THEN
      'On night 1 you are shown one Grinch. You may only hint — do not say the name outright.'
    WHEN 'liar_elf' THEN
      'You have no night power. You may only lie. If you tell the truth, you are out.'
    WHEN 'snowman' THEN
      'You win if the group votes you out. The game then continues for everyone else. If you are stolen at night, you do not win.'
    WHEN 'citizen' THEN
      'You are on the Nice side. Check in at night and vote during the day. You have no special powers.'
    ELSE ''
  END;
$function$;
