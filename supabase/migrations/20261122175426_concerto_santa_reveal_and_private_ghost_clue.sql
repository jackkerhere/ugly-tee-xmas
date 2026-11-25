-- Stage new night hit scenes across six beats. Santa is shown only for
-- an attributable rescue, and cause-of-death clues stay on ghost phones.

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
  expanded_hit boolean := kind = 'hit' AND beat_count IN (5, 6);
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
      WHEN expanded_hit AND beat = 2 THEN name || ' steps into the morning light.'
      WHEN expanded_hit AND beat = 3 THEN 'The village watches.'
      WHEN expanded_hit AND beat = 4 THEN 'The village holds its breath.'
      WHEN expanded_hit AND beat = 5 THEN 'The bells fall silent.'
      WHEN kind = 'vote' AND p_scene ? 'voteTally' AND beat = 2 THEN 'Vote tally'
      WHEN beat = beat_count - 1 AND name <> 'A villager' THEN name || ' steps into the morning light.'
      WHEN kind = 'vote' AND p_scene ? 'voteTally' AND beat = 3 THEN 'The village waits.'
      WHEN kind = 'vote' THEN 'The votes are in.'
      ELSE 'Dawn breaks over Concerto.'
    END) ORDER BY beat), '[]'::jsonb)
    INTO visible_beats
    FROM generate_series(1, least(p_visible_beats, beat_count)) AS beat;

    -- A public guest's picture and their outcome are separate reveal beats.
    IF p_visible_beats < (CASE WHEN expanded_hit THEN 2 ELSE greatest(1, beat_count - 1) END) THEN
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
  ) || CASE
    WHEN kind = 'vote' AND p_visible_beats >= 2 AND p_scene ? 'voteTally' THEN
      jsonb_build_object('voteTally', p_scene->'voteTally')
    WHEN expanded_hit AND p_visible_beats >= beat_count AND outcome = 'saved'
      AND p_scene->'santaSaved' = 'true'::jsonb THEN
      jsonb_build_object('santaSaved', true)
    ELSE '{}'::jsonb
  END;
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

  -- Ghost actions still resolve before the night. They have no public cards.

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
  -- The group requests a clue about an earlier death at night. Share it
  -- with signed-in ghosts only once that night has finished revealing.
  IF NOT pl.alive AND NULLIF(sess.ghost_clue, '') IS NOT NULL AND (
    sess.phase = 'day' OR (sess.phase = 'twist' AND sess.reveal_mode = 'post_morning')
  ) THEN
    payload := payload || jsonb_build_object('ghostClue', sess.ghost_clue);
  END IF;
  RETURN payload;
END;
$function$;
