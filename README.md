# VOID — setup guide

This zip has everything you need:

```
void-streaming/
├── index.html              ← the actual site (currently runs on hardcoded JS data)
├── README.md                ← this file
└── supabase/
    └── schema.sql            ← run this in Supabase to set up the database
```

Do these in order. 1–3 get you live with a domain. 4 is optional — only do it
once you actually want a real backend instead of the hardcoded JS library.

---

## 1. GitHub — get the code in a repo

1. Go to github.com → **New repository**
2. Name it (e.g. `void-streaming`) → keep it **Public** → don't add a README →
   **Create repository**
3. On the empty repo page click **"uploading an existing file"**
4. Drag in `index.html` (just that file for now — leave `supabase/` out of
   the repo unless you want it there for reference, it's not needed for the
   site to run)
5. Commit message: "initial site" → **Commit changes**

---

## 2. Vercel — deploy it

1. vercel.com → sign up/log in **with GitHub** (auto-connects the two)
2. **Add New → Project** → find your repo → **Import**
3. Framework preset: **Other** (it's a static `index.html`, no build step)
4. Leave everything else default → **Deploy**
5. You'll get a live URL like `void-streaming.vercel.app` in seconds

From now on: push to GitHub → Vercel auto-redeploys. That's the whole loop.

---

## 3. Custom domain

1. Buy a domain anywhere (Namecheap, Cloudflare, etc.) if you don't have one
2. Vercel → your project → **Settings → Domains** → enter your domain → **Add**
3. Vercel shows you DNS records to add:
   - `A` record → `76.76.21.21` (root domain)
   - `CNAME` → `cname.vercel-dns.com` (for `www`)
4. Add those records in your domain registrar's DNS panel
5. Wait for the green checkmark in Vercel (minutes to a few hours)

---

## 4. Supabase — when you want a real backend (optional)

Right now `index.html` has the entire show library, search logic, and watch
history hardcoded in JavaScript / localStorage. That's genuinely fine for a
prototype. Reach for Supabase when you want:

- An editable show library instead of hardcoded JS
- Real accounts + watch history that syncs across devices
- Anything multi-user

### Set it up

1. supabase.com → **New project** → name it, set a DB password (save it),
   pick a region → wait for it to spin up
2. Left sidebar → **SQL Editor** → **New query** → paste the entire contents
   of `supabase/schema.sql` → **Run**
   - This creates `shows`, `seasons`, `episodes`, `watch_history`, and
     `watchlist` tables, sets up Row Level Security (library is public read,
     watch history/watchlist are private per-user), and seeds it with the
     same 5 shows currently hardcoded in `index.html`
3. Left sidebar → **Settings → API** → copy two values:
   - **Project URL**
   - **anon public** key

### Wire it into the site

In `index.html`, add this near the top of the `<script>` tag:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script>
  const supabase = window.supabase.createClient(
    "YOUR_PROJECT_URL",
    "YOUR_ANON_PUBLIC_KEY"
  );
</script>
```

Then replace the hardcoded `library` object with a fetch, e.g.:

```js
async function loadLibrary(){
  const { data: shows } = await supabase
    .from('shows')
    .select('*, seasons(*, episodes(*))');
  return { shows };
}
```

You'll restructure `library.shows` to come from that instead of the inline
array — the shape (`title`, `slug`, `tmdb_id`/`tmdbId`, `seasons[].episodes[]`)
is the same on purpose so the rest of the query engine (`resolveQuery`,
`matchShow`, etc.) doesn't need to change.

4. Push the updated `index.html` to GitHub → Vercel auto-redeploys with the
   real backend live.

### If you add user accounts later

Supabase Auth (email, magic link, or OAuth) plugs into the same project —
`auth.users` is already referenced by `watch_history` and `watchlist` in the
schema, so accounts slot in without changing those tables.

---

## Quick reference

| Thing            | Where to find it again                          |
|------------------|--------------------------------------------------|
| Live site        | Vercel dashboard → your project                  |
| Code             | github.com/yourname/void-streaming               |
| Database tables  | Supabase → Table Editor                          |
| API keys         | Supabase → Settings → API                        |
| DNS records      | Vercel → Settings → Domains                       |
