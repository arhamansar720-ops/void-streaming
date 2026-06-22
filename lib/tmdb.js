const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE = "https://api.themoviedb.org/3";

export function tmdbEnabled() {
  return !!TMDB_API_KEY;
}

async function tmdbFetch(path, params = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", TMDB_API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  return res.json();
}

// Searches both movies and TV shows, returns TMDB's top-ranked match.
export async function searchTitle(query) {
  const data = await tmdbFetch("/search/multi", { query, include_adult: "false" });
  const results = (data.results || []).filter(
    (r) => r.media_type === "movie" || r.media_type === "tv"
  );
  return results[0] || null;
}

export async function getTvDetails(id) {
  return tmdbFetch(`/tv/${id}`);
}

export async function getSeasonDetails(id, season) {
  return tmdbFetch(`/tv/${id}/season/${season}`);
}

export async function getMovieDetails(id) {
  return tmdbFetch(`/movie/${id}`);
}

export async function getTrending() {
  const data = await tmdbFetch("/trending/all/week");
  return (data.results || []).filter((r) => r.media_type === "movie" || r.media_type === "tv");
}
