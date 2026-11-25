-- Keep private role labels and text consistent with the character cards.

CREATE OR REPLACE FUNCTION private.game_role_name(p_role text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_role
    WHEN 'grinch' THEN 'Grinch'
    WHEN 'tough_grinch' THEN 'Tough Grinch'
    WHEN 'krampus' THEN 'Krampus'
    WHEN 'santa' THEN 'Santa Claus'
    WHEN 'reindeer' THEN 'Reindeer'
    WHEN 'detective' THEN 'Elf Detective'
    WHEN 'mrs_claus' THEN 'Mrs Claus'
    WHEN 'gingerbread' THEN 'Gingerbread Man'
    WHEN 'fruitcake' THEN 'Fruitcake'
    WHEN 'witness' THEN 'Witness'
    WHEN 'liar_elf' THEN 'Liar Elf'
    WHEN 'snowman' THEN 'Snowman'
    WHEN 'citizen' THEN 'Citizen'
    ELSE 'Unknown'
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
