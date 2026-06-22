# VOID — Next.js rebuild

This is the real-framework version of the static `index.html` prototype.
Same Void Chromatic design, same search/intent engine, same follow-up
context — but now structured the way a real app is structured.

```
void-streaming-next/
├── app/
│   ├── layout.js            ← root layout, self-hosted fonts via next/font
│   ├── globals.css          ← Void Chromatic design tokens + styles
│   ├── page.js               ← the actual UI (client component)
│   └── api/
│       └── search/route.js   ← server-side search/suggestion/follow-up API
├── components/
│   ├── Starfield.js
│   ├── RingParticle.js
│   └── WaveDivider.js
├── lib/
│   ├── library.js             ← data layer: Supabase if configured, else fallback
│   ├── queryEngine.js         ← pure search/match/follow-up logic (server-side only)
│   └── supabaseClient.js
├── supabase/
│   └── schema.sql
├── package.json
├── next.config.js
├── jsconfig.json
└── .env.example
```

## What actually changed vs. the static HTML version

This is the real architectural difference, not just a file reorganization:

- **The search/match logic moved server-side.** In the old version, all the
  fuzzy matching and episode resolution ran in the browser — anyone could
  open dev tools and see the entire "engine." Now the client just sends
  `{ query, context }` to `POST /api/search` and gets back a structured
  result. The actual logic lives in `lib/queryEngine.js`, which only runs
  on the server.
- **The data layer is abstracted.** `lib/library.js` tries Supabase first,
  falls back to the hardcoded list automatically if Supabase isn't
  configured. Nothing else in the app needs to know which one is active.
- **Conversation context is passed explicitly**, the same pattern real chat
  APIs use: the client holds the last result + last suggestions in a ref,
  sends it with every request, server uses it to resolve follow-ups
  ("next episode," "something else," etc.) statelessly.

## Running it locally

You need Node.js installed. From this folder:

```
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploying

Same GitHub → Vercel flow as before, just point Vercel at this folder
instead of the single HTML file:

1. Push this whole `void-streaming-next` folder to your GitHub repo
   (replacing the old `index.html`-only setup)
2. In Vercel, **Add New → Project** → import the repo
3. Framework preset: Vercel will auto-detect **Next.js** this time —
   that's correct, leave it
4. Deploy

If you're updating an existing Vercel project that was pointed at the old
static file, just push this code to the same repo — Vercel will detect the
framework change on the next deploy automatically.

## Searching any show or movie (TMDB)

By default, without any setup, search is limited to the 5 hardcoded shows
in `lib/library.js`. To search basically anything — any show or movie in
TMDB's catalog — wire in a free TMDB API key:

1. Go to themoviedb.org → sign up → **Settings → API** → request an API key
   (choose "Developer" — it's free, just needs a basic use-case description)
2. Copy the **API Key (v3 auth)** value
3. **Local dev**: copy `.env.example` to `.env.local`, paste it into
   `TMDB_API_KEY=`
4. **Vercel**: Project → Settings → Environment Variables → add
   `TMDB_API_KEY` with that value → redeploy

Once that's set, `app/api/search/route.js` automatically switches from the
hardcoded library to live TMDB search — title matching, season/episode
lookups, real episode titles, and trending picks for "what should I watch"
all come straight from TMDB instead of the fixed list. Movies and TV shows
both work; movies skip the season/episode picker and play directly.

This is completely independent from Supabase — you can use TMDB search
with or without Supabase configured. Supabase only affects where the
*fallback* show list lives if TMDB isn't set up; it has no effect once
`TMDB_API_KEY` is present, since TMDB search takes priority.

`TMDB_API_KEY` is **not** prefixed with `NEXT_PUBLIC_`, which means it's
only ever read on the server inside the API route — it's never sent to the
browser, so it can't be extracted from the deployed site's client code.

## Wiring up Supabase (optional)

1. Run `supabase/schema.sql` in your Supabase project's SQL Editor (same
   file as before — same shows, seasons, episodes, watch_history, watchlist
   tables, same Row Level Security)
2. Copy your Project URL and anon public key from Supabase → Settings → API
3. In Vercel: **Settings → Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Redeploy. `lib/library.js` will automatically start pulling from
   Supabase instead of the hardcoded fallback — no other code changes
   needed.

For local dev, copy `.env.example` to `.env.local` and fill in the same two
values.

## Known gaps / next steps

- No authentication yet — `watch_history`/`watchlist` tables exist in the
  schema but aren't wired to real user accounts. Supabase Auth (email or
  OAuth) would plug in directly on top of this.
- No tests. For something private/personal this is probably fine; worth
  adding before this touches any other users.
- The episode strip re-fetches via `/api/search` on click rather than
  having a dedicated `/api/episode` endpoint — fine at this scale, but a
  true "enterprise" version would likely split that into its own route.
