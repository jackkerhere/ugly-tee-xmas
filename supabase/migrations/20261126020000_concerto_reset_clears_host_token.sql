-- Retired sessions kept their host token, so opening a new lobby, rehearsal,
-- or party lobby could not reuse the live host token (unique constraint).

CREATE OR REPLACE FUNCTION private.game_reset(p_is_test boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.game_sessions
  SET is_current = false,
      host_token = NULL,
      updated_at = now()
  WHERE is_current;
  INSERT INTO public.game_sessions (is_current, is_test, phase)
  VALUES (true, coalesce(p_is_test, false), 'not_started');
  RETURN jsonb_build_object('ok', true, 'phase', 'not_started');
END;
$function$;
