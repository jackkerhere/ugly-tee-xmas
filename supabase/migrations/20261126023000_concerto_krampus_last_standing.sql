-- Last-standing Krampus wins the round, with matching end copy and a TV ending.

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

  IF n_alive = 1 AND n_krampus = 1 THEN
    UPDATE public.game_sessions
    SET winner_side = 'krampus', updated_at = now()
    WHERE id = p_session_id AND winner_side IS NULL;
    RETURN 'krampus';
  END IF;

  IF n_alive = 0 THEN
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
  IF sess.winner_side = 'krampus' THEN
    beats := ARRAY['Krampus wins — the last one standing.'];
  ELSIF sess.winner_side = 'no_team' THEN
    beats := ARRAY['No team won the round.'];
  ELSE
    pool := CASE sess.winner_side
      WHEN 'nice' THEN 'win_nice'
      WHEN 'grinches' THEN 'win_grinches'
    END;
    beats := array_append(beats, private.game_pick_line(p_session_id, pool));
  END IF;
  IF sess.snowman_won THEN
    beats := array_append(beats, 'Meanwhile the Snowman is still technically a winner, and would like that on a mug.');
  END IF;
  RETURN private.game_scene('winner', NULL, sess.winner_side, VARIADIC beats);
END;
$function$;

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
  ELSIF p_sess.winner_side = 'krampus' THEN
    winner_text := 'Krampus wins — the last one standing.';
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
      'You hunt alone. Take out one Grinch (regular or Tough) and one Concertorant with your own unshared night hits to earn a personal win; the round keeps going. If you are the last one standing, you win the round. The Elf Detective sees you as bad.'
    WHEN 'santa' THEN
      'Protect one player each night. You can pick yourself. You cannot pick the same person twice in a row.'
    WHEN 'reindeer' THEN
      'Protect someone else if you survive the night. You cannot guard yourself. You can guard the same player again.'
    WHEN 'detective' THEN
      'Check one other living player each night. Get a private Yes for a Grinch, Tough Grinch or Krampus. Everyone else gives No.'
    WHEN 'mrs_claus' THEN
      'Hot Cocoa protects whoever is targeted that night and keeps their identity secret. Bitter Biscuit deals 1 damage to a player. Use each item once per game and only one per night. Hot Cocoa can save you on Night 1 or Night 2.'
    WHEN 'gingerbread' THEN
      'You have no night power while you are in the game. When you are out, you choose one player to take down with you.'
    WHEN 'fruitcake' THEN
      'You have two lives and no night power. You survive your first unsaved night hit and lose one life. If voted out in the morning, you become a ghost immediately. Your survival stays secret.'
    WHEN 'witness' THEN
      'On night 1 you are shown one Grinch. You may only hint — do not say the name outright.'
    WHEN 'liar_elf' THEN
      'Tell the truth and you’re punished. Take a shot for each truth.'
    WHEN 'snowman' THEN
      'You win if the group votes you out. The game then continues for everyone else. If you are stolen at night, you do not win.'
    WHEN 'citizen' THEN
      'You are on the Nice side. Check in at night and vote during the day. You have no special powers.'
    ELSE ''
  END;
$function$;
