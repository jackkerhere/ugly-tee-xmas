-- Qualify the pin lockout conflict target so guest_id is not ambiguous with the parameter.

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

