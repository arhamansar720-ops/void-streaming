import { supabase } from "./supabaseClient";

function buildSeasons(seasonCount, epCounts) {
  const seasons = [];
  for (let s = 1; s <= seasonCount; s++) {
    const epCount = epCounts[s - 1] || 10;
    const episodes = [];
    for (let e = 1; e <= epCount; e++) {
      episodes.push({ episode: e, title: `Episode ${e}` });
    }
    seasons.push({ season: s, episodes });
  }
  return seasons;
}

// Fallback library — used automatically if Supabase isn't configured yet.
// Same shape as the rows schema.sql produces, so swapping sources later
// requires no changes to queryEngine.js.
const FALLBACK_LIBRARY = {
  shows: [
    { title: "Dexter", slug: "dexter", tmdbId: 1405, seasons: buildSeasons(4, [12, 12, 12, 12]) },
    { title: "Breaking Bad", slug: "breaking-bad", tmdbId: 1396, seasons: buildSeasons(5, [7, 13, 13, 13, 16]) },
    { title: "The Office", slug: "the-office", tmdbId: 2316, seasons: buildSeasons(3, [6, 22, 23]) },
    { title: "Severance", slug: "severance", tmdbId: 95396, seasons: buildSeasons(2, [9, 10]) },
    { title: "Stranger Things", slug: "stranger-things", tmdbId: 66732, seasons: buildSeasons(4, [8, 9, 8, 9]) },
  ],
};

let cache = null;
let cacheExpires = 0;

/**
 * Returns the media library. Pulls from Supabase if configured,
 * otherwise serves the hardcoded fallback. Cached in-memory for 60s
 * per server instance to avoid hammering the DB on every search request.
 */
export async function getLibrary() {
  if (!supabase) return FALLBACK_LIBRARY;

  const now = Date.now();
  if (cache && now < cacheExpires) return cache;

  const { data, error } = await supabase
    .from("shows")
    .select("title, slug, tmdb_id, seasons(season, episodes(episode, title))");

  if (error || !data) {
    console.error("Supabase fetch failed, falling back to local library:", error?.message);
    return FALLBACK_LIBRARY;
  }

  const shows = data.map((s) => ({
    title: s.title,
    slug: s.slug,
    tmdbId: s.tmdb_id,
    seasons: (s.seasons || [])
      .sort((a, b) => a.season - b.season)
      .map((season) => ({
        season: season.season,
        episodes: (season.episodes || [])
          .sort((a, b) => a.episode - b.episode)
          .map((ep) => ({ episode: ep.episode, title: ep.title })),
      })),
  }));

  cache = { shows };
  cacheExpires = now + 60_000;
  return cache;
}
