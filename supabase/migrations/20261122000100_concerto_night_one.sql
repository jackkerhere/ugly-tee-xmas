-- Start a dealt round directly on Night 1. The host still starts the round.
-- Mrs Claus's single use of Hot Cocoa can protect her on Night 1 or Night 2.
-- A missing Santa save no longer lets an eliminated Reindeer protect their target.
-- Based on the lobby, TV reveal/privacy, and deck migrations loaded in rehearsal.

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

  UPDATE public.game_sessions
  SET phase = 'night', night_number = 1, day_number = 0, updated_at = now()
  WHERE id = sess.id;

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
  det_target uuid;
  det_role text;
  scenes jsonb := '[]'::jsonb;
  cause text;
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
        SELECT g.id AS gid
        FROM public.guests AS g
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
      'You play alone. Each night you steal one person. You have one life. You win only if you are the last one standing. You are not a Grinch: if the Grinches reach their numbers, they win, even if you are still alive. The Elf Detective sees you as bad.'
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
