// Long-term watch history, stored on this device (localStorage).
// One entry per show/movie, newest first. TV entries keep the last episode
// watched plus a map of every episode ever opened ("s-e" -> timestamp).

const KEY = "void_history";
const LEGACY_KEY = "void_continue";
const MAX_ENTRIES = 200;
const MAX_EPISODES = 600;

const entryKey = (mediaType, tmdbId) => `${mediaType}:${tmdbId}`;

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "null");
    if (Array.isArray(list)) return list;
    // One-time migration from the old single "continue watching" slot.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
    if (legacy?.tmdbId) {
      const at = Date.now();
      const e = {
        key: entryKey(legacy.mediaType, legacy.tmdbId), mediaType: legacy.mediaType, tmdbId: legacy.tmdbId,
        title: legacy.title, year: legacy.year, season: legacy.season, episode: legacy.episode,
        episodeTitle: legacy.episodeTitle, watchedAt: at, firstWatchedAt: at, plays: 1,
        episodes: legacy.season ? { [`${legacy.season}-${legacy.episode}`]: at } : {},
      };
      save([e]);
      return [e];
    }
  } catch { /* storage blocked or corrupt */ }
  return [];
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES))); } catch { /* quota or blocked */ }
}

export function getHistory() {
  return load();
}

export function recordWatch(r, server) {
  const list = load();
  const key = entryKey(r.mediaType, r.tmdbId);
  const prev = list.find((e) => e.key === key);
  const at = Date.now();
  let episodes = prev?.episodes || {};
  if (r.mediaType === "tv") {
    episodes = { ...episodes, [`${r.season}-${r.episode}`]: at };
    const keys = Object.keys(episodes);
    if (keys.length > MAX_EPISODES) {
      keys.sort((a, b) => episodes[a] - episodes[b]).slice(0, keys.length - MAX_EPISODES).forEach((k) => delete episodes[k]);
    }
  }
  const entry = {
    key,
    mediaType: r.mediaType,
    tmdbId: r.tmdbId,
    imdbId: r.imdbId,
    title: r.showTitle,
    year: r.year,
    backdrop: r.backdrop || prev?.backdrop || null,
    poster: r.poster || prev?.poster || null,
    season: r.season,
    episode: r.episode,
    episodeTitle: r.episodeTitle,
    totalSeasons: r.totalSeasons,
    server: server || prev?.server,
    watchedAt: at,
    firstWatchedAt: prev?.firstWatchedAt || at,
    plays: (prev?.plays || 0) + 1,
    episodes,
  };
  const next = [entry, ...list.filter((e) => e.key !== key)];
  save(next);
  return next;
}

export function watchedEpisodes(mediaType, tmdbId) {
  return load().find((e) => e.key === entryKey(mediaType, tmdbId))?.episodes || {};
}

export function removeFromHistory(key) {
  const next = load().filter((e) => e.key !== key);
  save(next);
  return next;
}

export function clearHistory() {
  save([]);
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* blocked */ }
  return [];
}

export function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? "yesterday" : `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} wk ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
