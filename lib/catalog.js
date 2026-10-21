// Metadata layer. Uses TMDB when TMDB_API_KEY is set, otherwise Cinemeta
// (Stremio's public catalog — no key needed). Both return the same shapes:
//   item:  { tmdbId, imdbId, type: "movie" | "tv", title, year, genres }
//   show:  item + { seasons: [{ season, episodes: [{ episode, title }] }] }

const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB = "https://api.themoviedb.org/3";
const CINEMETA = "https://v3-cinemeta.strem.io";

export const GENRES = [
  "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family",
  "Fantasy", "History", "Horror", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western",
];

// TMDB uses numeric genre ids, and TV has its own (merged) set.
const TMDB_GENRES = {
  movie: { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Mystery: 9648, Romance: 10749, "Sci-Fi": 878, Thriller: 53, War: 10752, Western: 37 },
  tv: { Action: 10759, Adventure: 10759, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 10765, Mystery: 9648, "Sci-Fi": 10765, War: 10768, Western: 37, Thriller: 80, Horror: 9648 },
};

// In-memory cache per server instance. We don't use Next's Data Cache: it's shared
// across deployments, and Cinemeta now and then returns an empty body that would stick for an hour.
const memo = new Map();
const MEMO_MS = 30 * 60 * 1000;

async function getJson(url, { timeout = 6000, cacheable = true, valid = () => true } = {}) {
  const hit = cacheable && memo.get(url);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.data;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}`);
  const data = await res.json();
  if (cacheable && valid(data)) {
    if (memo.size > 500) memo.delete(memo.keys().next().value);
    memo.set(url, { at: Date.now(), data });
  }
  return data;
}

function tmdb(path, params = {}) {
  const url = new URL(TMDB + path);
  url.searchParams.set("api_key", TMDB_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return getJson(url.toString());
}

const norm = (s) => (s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// Prefer exact title hits, then the provider's own (popularity) order.
// Returns [{ c, score }], lower score = better.
function rank(candidates, text, { type, year } = {}) {
  const q = norm(text);
  return candidates
    .map((c, i) => {
      const t = norm(c.title);
      let score = i * 0.5;
      if (t === q) score -= 20;
      else if (t.startsWith(q) || q.startsWith(t)) score -= 8;
      else if (t.includes(q)) score -= 4;
      else {
        const d = lev(t, q);
        // A 1–2 letter typo of a long title counts as a hit, so popularity can pick "Interstellar" over a film literally named "Interstelar".
        score += q.length >= 6 && d <= 2 ? -17 : Math.min(14, d * 1.5);
      }
      if (type && c.type === type) score -= 5;
      if (year && c.year && String(c.year) === String(year)) score -= 12;
      return { c, score };
    })
    .sort((a, b) => a.score - b.score);
}

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

// Among near-tied candidates ("Fight Club" the film vs. a 2021 series), the more popular wins.
async function pickBest(scored, popularityOf, { type, year } = {}) {
  if (!scored.length) return null;
  let group = scored.filter((x) => x.score <= scored[0].score + 4).slice(0, 4);
  if (type && group.some((x) => x.c.type === type)) group = group.filter((x) => x.c.type === type);
  if (year && group.some((x) => String(x.c.year) === String(year))) group = group.filter((x) => String(x.c.year) === String(year));
  const pops = await Promise.all(group.map((x) => popularityOf(x.c).catch((e) => { console.warn("popularity failed:", x.c.title, e.message); globalThis.__trace?.push(`popfail ${x.c.title}: ${e.message}`); return -1; })));
  globalThis.__trace?.push(JSON.stringify({ scored: scored.slice(0, 6).map((x) => [x.c.title, x.c.type, x.c.year, +x.score.toFixed(1)]), group: group.map((x) => x.c.title), pops }));
  let best = -1, bestPop = -Infinity;
  pops.forEach((p, i) => { if (p > bestPop) { bestPop = p; best = i; } });
  if (best === -1 || bestPop < 0) {
    // Every candidate in the tie group was broken — fall through to the rest.
    const rest = scored.slice(group.length);
    return rest.length ? pickBest(rest, popularityOf) : null;
  }
  return group[best].c;
}

// ---------------- TMDB ----------------
const tmdbItem = (r, type) => ({
  tmdbId: r.id,
  pop: r.popularity || 0,
  type: type || (r.media_type === "movie" ? "movie" : "tv"),
  title: r.title || r.name,
  year: (r.release_date || r.first_air_date || "").slice(0, 4),
});

const tmdbProvider = {
  async search(text, opts) {
    const d = await tmdb("/search/multi", { query: text, include_adult: "false" });
    const list = (d.results || []).filter((r) => r.media_type === "movie" || r.media_type === "tv").map((r) => tmdbItem(r));
    return rank(list, text, opts);
  },
  popularity: async (item) => item.pop,
  async show(item) {
    const d = await tmdb(`/tv/${item.tmdbId}`);
    const seasonNums = (d.seasons || []).map((s) => s.season_number).filter((n) => n > 0);
    return {
      ...item, title: d.name, genres: (d.genres || []).map((g) => g.name),
      seasonNums,
      async loadSeason(n) {
        const s = await tmdb(`/tv/${item.tmdbId}/season/${n}`);
        return s.episodes.map((e) => ({ episode: e.episode_number, title: e.name }));
      },
    };
  },
  async movie(item) {
    const d = await tmdb(`/movie/${item.tmdbId}`);
    return { ...item, title: d.title, year: (d.release_date || "").slice(0, 4), genres: (d.genres || []).map((g) => g.name) };
  },
  async discover({ type, genre }) {
    const types = type ? [type] : ["movie", "tv"];
    const lists = await Promise.all(
      types.map(async (t) => {
        if (!genre) {
          const d = await tmdb(`/trending/${t}/week`);
          return d.results.map((r) => tmdbItem(r, t));
        }
        const gid = TMDB_GENRES[t][genre];
        if (!gid) return [];
        const d = await tmdb(`/discover/${t}`, { with_genres: gid, sort_by: "popularity.desc", "vote_count.gte": 300 });
        return d.results.map((r) => tmdbItem(r, t));
      })
    );
    return interleave(lists);
  },
  async similar(item) {
    const t = item.type === "movie" ? "movie" : "tv";
    const d = await tmdb(`/${t}/${item.tmdbId}/recommendations`);
    return d.results.map((r) => tmdbItem(r, t));
  },
};

// ---------------- Cinemeta ----------------
const cmType = (type) => (type === "movie" ? "movie" : "series");
const cmItem = (m) => ({
  imdbId: m.imdb_id || m.id,
  tmdbId: m.moviedb_id || null,
  type: m.type === "movie" ? "movie" : "tv",
  title: m.name,
  year: (m.releaseInfo || m.year || "").toString().slice(0, 4),
  genres: m.genres || m.genre || [],
});

async function cmMeta(item) {
  const url = `${CINEMETA}/meta/${cmType(item.type)}/${item.imdbId}.json`;
  let d = await getJson(url, { valid: (x) => !!x?.meta?.name });
  if (!d?.meta?.name) d = await getJson(url, { cacheable: false }); // one retry — empty bodies are usually transient
  if (!d?.meta?.name) throw new Error(`no meta for ${item.imdbId}`);
  return d.meta;
}

const cinemetaProvider = {
  async search(text, opts) {
    const q = encodeURIComponent(text);
    const [movies, series] = await Promise.all(
      ["movie", "series"].map((t) => getJson(`${CINEMETA}/catalog/${t}/top/search=${q}.json`, { valid: (d) => d.metas?.length > 0 }).then((d) => d.metas || []).catch(() => []))
    );
    if (!movies.length && !series.length) console.warn(`cinemeta: no results for "${text}"`);
    return rank(interleave([series.map(cmItem), movies.map(cmItem)]), text, opts);
  },
  async popularity(item) {
    const m = await cmMeta(item);
    if (item.type === "tv" && !(m.videos || []).some((v) => v.season > 0)) return -1; // no episodes = unplayable stub
    return m.popularities?.moviedb ?? m.popularity ?? 0;
  },
  async show(item) {
    const m = await cmMeta(item);
    const bySeason = {};
    (m.videos || []).forEach((v) => {
      if (!v.season || v.season < 1) return;
      (bySeason[v.season] ||= []).push({ episode: v.episode ?? v.number, title: v.name || v.title || `Episode ${v.episode ?? v.number}` });
    });
    Object.values(bySeason).forEach((eps) => eps.sort((a, b) => a.episode - b.episode));
    return {
      ...cmItem(m), type: "tv",
      seasonNums: Object.keys(bySeason).map(Number).sort((a, b) => a - b),
      async loadSeason(n) { return bySeason[n] || []; },
    };
  },
  async movie(item) {
    return { ...cmItem(await cmMeta(item)), type: "movie" };
  },
  async discover({ type, genre }) {
    const types = type ? [type] : ["movie", "tv"];
    // Genre asks mix what's popular now with all-time highly rated; plain asks are just "popular now".
    const catalogs = genre ? ["imdbRating", "top"] : ["top"];
    const lists = await Promise.all(
      types.flatMap((t) =>
        catalogs.map((c) =>
          getJson(`${CINEMETA}/catalog/${cmType(t)}/${c}${genre ? `/genre=${encodeURIComponent(genre)}` : ""}.json`)
            .then((d) => (d.metas || []).slice(0, 25).map((m) => ({ ...cmItem(m), type: t })))
            .catch(() => [])
        )
      )
    );
    return interleave(lists);
  },
  async similar(item) {
    // No recommendations endpoint — fall back to the title's lead genre.
    const genre = (item.genres || []).find((g) => GENRES.includes(g) && g !== "Drama") || (item.genres || []).find((g) => GENRES.includes(g));
    const d = await getJson(`${CINEMETA}/catalog/${cmType(item.type)}/imdbRating${genre ? `/genre=${encodeURIComponent(genre)}` : ""}.json`);
    const list = (d.metas || []).slice(0, 30).map((m) => ({ ...cmItem(m), type: item.type }));
    return list.filter((x) => x.imdbId !== item.imdbId);
  },
};

function interleave(lists) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) lists.forEach((l) => l[i] && out.push(l[i]));
  return out;
}

const primary = TMDB_KEY ? tmdbProvider : cinemetaProvider;
const backup = TMDB_KEY ? cinemetaProvider : null;

async function withBackup(fn) {
  try { return await fn(primary); } catch (err) {
    if (!backup) throw err;
    console.error("catalog primary failed, using backup:", err.message);
    return fn(backup);
  }
}

// Everything playable needs a TMDB id (every embed server keys on it).
// Cinemeta usually has one; if not, ask TMDB when we can.
async function ensureTmdb(item) {
  if (item.tmdbId || !TMDB_KEY || !item.imdbId) return item;
  try {
    const d = await tmdb(`/find/${item.imdbId}`, { external_source: "imdb_id" });
    const hit = (item.type === "movie" ? d.movie_results : d.tv_results)?.[0];
    return hit ? { ...item, tmdbId: hit.id } : item;
  } catch { return item; }
}

export const catalog = {
  provider: TMDB_KEY ? "tmdb" : "cinemeta",
  search: (text, opts = {}) => withBackup((p) => p.search(text, opts)).then((l) => l.map((x) => x.c)),
  findOne: (text, opts = {}) =>
    withBackup(async (p) => pickBest(await p.search(text, opts), (c) => p.popularity(c), opts)),
  show: (item) => withBackup((p) => p.show(item)).then(ensureTmdb),
  movie: (item) => withBackup((p) => p.movie(item)).then(ensureTmdb),
  discover: (opts = {}) => withBackup((p) => p.discover(opts)),
  similar: (item) => withBackup((p) => p.similar(item)),
};
