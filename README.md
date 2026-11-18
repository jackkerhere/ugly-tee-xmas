# Ugly Tee Christmas — invitation website (preview)

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
- `me.html?k=<token>` — per-guest page (name, Secret Santa, ugly-tee person, “what I’m bringing”)

For design screenshots only, a fake guest exists at `me.html?k=demo` (Demo Guest / Demo Friend A / Demo Friend B). This is not a real draw. Do not put real pairings in the repo.

## Song

Place the MP3 at `assets/song.mp3`. The player already points there and falls back if the file is missing.

## Data layer

- `assets/js/data.js` — facade
- `assets/js/adapters/mock.js` — local/demo adapter (used now)
- `assets/js/adapters/supabase.js` — stub only, not connected
