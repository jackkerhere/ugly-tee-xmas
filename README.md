# Ugly Tee Christmas — invitation website

Live: https://jackkerhere.github.io/ugly-tee-xmas/
Repo: https://github.com/jackkerhere/ugly-tee-xmas

The site stays noindex/nofollow, and robots.txt disallows crawling.

## Preview locally

From this folder:

```bash
python3 -m http.server 4173
```

Then open http://127.0.0.1:4173/

## Pages

- `index.html` — Home (gift screen, hero poster, details, crew, song)
- `itinerary.html` — spoiler-free run of the night
- `menu.html` — potluck + drinks placeholders
- `me.html` — pick your name, create a PIN or log in, then your private page (gifts, chat, wish list, dish)

The live site talks to Supabase only through RPCs. Draw pairings never ship to the client. To preview the flow without the live guest list, open `me.html?demo=1` (Demo Guest / Demo Friend A / Demo Friend B). That mock is not a real draw. Do not put real pairings in the repo.

## Song

The party song is at `assets/song.mp3`. Tapping the gift starts it immediately (and loops). A mute button stays on screen. Tab switches do not reload the page, so the song keeps playing. Direct URLs still work.

## Data layer

- `assets/js/data.js` — facade (Supabase by default; `?demo=1` uses the mock adapter)
- `assets/js/adapters/mock.js` — local/demo adapter
- `assets/js/adapters/supabase.js` — RPC client (publishable key only; never a service-role key)

## Reset a guest’s claim

If someone is locked out of their PIN, Chris can reset that guest’s claim in the Supabase SQL editor, after Jack asks:

```sql
SELECT private.reset_guest_claim('Display Name');
```

This only clears the PIN so they can claim their name again. It is not exposed to the public site (`anon` cannot call it). It does not change draws or invite tokens. Do not select or print draw rows when using it.

## Temporary test guests

The “Who are you?” grid shows each guest’s portrait (Jack’s drawings) with the name under it. Claimed names are dimmed with a small lock. Temporary test names use a generic elf placeholder.

Two temporary names, Test Elf 1 and Test Elf 2, may appear at the bottom of the My page grid (marked “test”) so Jack can try two accounts. They have their own draw rows only; real guests are not changed.

When testing is finished, Chris can remove them from the Supabase SQL editor (do not run this until Jack is done):

```sql
SELECT private.remove_test_guests();
```

This deletes the test guests and their dishes, wish lists, chat threads, and messages. It does not change real guests or real draws, and it is not exposed on the public site.
