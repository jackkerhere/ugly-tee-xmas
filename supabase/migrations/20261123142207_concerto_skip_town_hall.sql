CREATE FUNCTION private.game_host_skip_town_hall(
  p_host_token text,
  p_expected_deadline timestamptz
)
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

  IF sess.phase IS DISTINCT FROM 'day' OR sess.town_hall_ends_at IS NULL OR p_expected_deadline IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Wait for an active Town Hall countdown.');
  END IF;

  IF sess.town_hall_ends_at <= statement_timestamp() THEN
    RETURN private.game_host_state(p_host_token);
  END IF;

  IF sess.town_hall_ends_at IS DISTINCT FROM p_expected_deadline THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale', 'message', 'This countdown has changed.');
  END IF;

  -- Match the clock used by the game payload so this response opens voting.
  UPDATE public.game_sessions
  SET town_hall_ends_at = statement_timestamp(),
      updated_at = now()
  WHERE id = sess.id;

  RETURN private.game_host_state(p_host_token);
END;
$function$;

CREATE FUNCTION public.game_host_skip_town_hall(host_token text, expected_deadline timestamptz)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.game_host_skip_town_hall(host_token, expected_deadline);
$function$;

REVOKE ALL ON FUNCTION
  private.game_host_skip_town_hall(text, timestamptz), public.game_host_skip_town_hall(text, timestamptz)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  private.game_host_skip_town_hall(text, timestamptz), public.game_host_skip_town_hall(text, timestamptz)
TO anon, authenticated;
