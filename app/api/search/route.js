import { NextResponse } from "next/server";
import { extractSeasonEpisode, normalize, isSuggestionQuery, resolveQuery, buildSuggestionReply, tryFollowup } from "@/lib/queryEngine";
import { getLibrary } from "@/lib/library";
import { tmdbEnabled, searchTitle, getTvDetails, getSeasonDetails, getMovieDetails, getTrending } from "@/lib/tmdb";

function streamUrlMovie(id) {
  return `https://www.vidking.net/embed/movie/${id}`;
}
function streamUrlTv(id, season, episode) {
  return `https://www.vidking.net/embed/tv/${id}/${season}/${episode}`;
}

const FOLLOWUP_NEXT = /^(next|next episode|next one|continue|keep going|play next|play the next one|next ep)\b/;
const FOLLOWUP_PREV = /^(previous|last episode|go back|prior episode|back one)\b/;
const FOLLOWUP_ANOTHER = /^(another|something else|different one|not (that|this)|skip (this|that)|none of (those|these)|other options?)\b/;
const FOLLOWUP_SEASON_ONLY = /^(what about |try |go to |switch to )?season\s*(\d{1,2})$/;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, reason: "bad-request" }, { status: 400 });
  }
  const { query, context } = body || {};
  if (!query || typeof query !== "string") {
    return NextResponse.json({ ok: false, reason: "missing-query" }, { status: 400 });
  }

  if (!tmdbEnabled()) {
    return handleFallback(query, context);
  }

  try {
    return await handleTmdb(query, context);
  } catch (err) {
    console.error("TMDB search failed, falling back to local library:", err.message);
    return handleFallback(query, context);
  }
}

async function buildTrendingSuggestion(context) {
  const trending = await getTrending();
  const excludeIds = context?.lastSuggestionIds || [];
  const pool = trending.filter((item) => !excludeIds.includes(item.id));
  const usePool = pool.length >= 3 ? pool : trending;
  const picks = usePool.slice(0, 8).sort(() => Math.random() - 0.5).slice(0, 3);
  const lines = picks.map((p) => `${p.title || p.name} — try "${(p.title || p.name).toLowerCase()}"`);
  return NextResponse.json({
    kind: "suggestion",
    text: `Trending this week: ${lines.join(" · ")}.`,
    ids: picks.map((p) => p.id),
  });
}

// ============================================================
// TMDB-backed path — searches the real catalog, not a fixed list
// ============================================================
async function handleTmdb(query, context) {
  const t = normalize(query);

  // "something else" / "another one" after a suggestion list
  if (FOLLOWUP_ANOTHER.test(t) && context?.lastSuggestionIds?.length) {
    return buildTrendingSuggestion(context);
  }

  // next/previous episode, season jump — only meaningful if we just watched a TV episode
  const lr = context?.lastResult;
  if (lr && lr.mediaType === "tv") {
    if (FOLLOWUP_NEXT.test(t) || FOLLOWUP_PREV.test(t)) {
      return NextResponse.json(await stepTmdbEpisode(lr, FOLLOWUP_NEXT.test(t) ? 1 : -1));
    }
    const seasonOnly = t.match(FOLLOWUP_SEASON_ONLY);
    if (seasonOnly) {
      const jumped = await jumpTmdbSeason(lr, parseInt(seasonOnly[2]));
      if (jumped) return NextResponse.json(jumped);
    }
  }

  if (isSuggestionQuery(query)) {
    return buildTrendingSuggestion(context);
  }

  const { season, episode, finale, text } = extractSeasonEpisode(t);
  if (!text) return NextResponse.json({ kind: "no-match" });

  const found = await searchTitle(text);
  if (!found) return NextResponse.json({ kind: "no-match" });

  if (found.media_type === "movie") {
    const details = await getMovieDetails(found.id);
    return NextResponse.json({
      kind: "result",
      result: {
        ok: true,
        mediaType: "movie",
        tmdbId: found.id,
        showTitle: details.title,
        year: (details.release_date || "").slice(0, 4),
        streamUrl: streamUrlMovie(found.id),
      },
    });
  }

  const details = await getTvDetails(found.id);
  let s = season, e = episode;
  if (finale) s = details.number_of_seasons;
  if (!s) s = 1;
  const seasonData = await getSeasonDetails(found.id, s);
  if (finale) e = seasonData.episodes.length;
  if (!e) e = 1;
  const epObj = seasonData.episodes.find((ep) => ep.episode_number === e) || seasonData.episodes[0];

  return NextResponse.json({
    kind: "result",
    result: {
      ok: true,
      mediaType: "tv",
      tmdbId: found.id,
      showTitle: details.name,
      season: s,
      episode: epObj.episode_number,
      episodeTitle: epObj.name,
      totalSeasons: details.number_of_seasons,
      seasonEpisodes: seasonData.episodes.map((ep) => ({ episode: ep.episode_number, title: ep.name })),
      streamUrl: streamUrlTv(found.id, s, epObj.episode_number),
    },
  });
}

async function stepTmdbEpisode(lr, dir) {
  const details = await getTvDetails(lr.tmdbId);
  let season = lr.season;
  let seasonData = await getSeasonDetails(lr.tmdbId, season);
  let epIdx = seasonData.episodes.findIndex((ep) => ep.episode_number === lr.episode) + dir;

  if (epIdx >= seasonData.episodes.length) {
    if (season + 1 <= details.number_of_seasons) { season++; seasonData = await getSeasonDetails(lr.tmdbId, season); epIdx = 0; }
    else epIdx = seasonData.episodes.length - 1;
  } else if (epIdx < 0) {
    if (season - 1 >= 1) { season--; seasonData = await getSeasonDetails(lr.tmdbId, season); epIdx = seasonData.episodes.length - 1; }
    else epIdx = 0;
  }
  const ep = seasonData.episodes[epIdx];
  return {
    kind: "result",
    result: {
      ok: true, mediaType: "tv", tmdbId: lr.tmdbId, showTitle: details.name,
      season, episode: ep.episode_number, episodeTitle: ep.name,
      totalSeasons: details.number_of_seasons,
      seasonEpisodes: seasonData.episodes.map((e) => ({ episode: e.episode_number, title: e.name })),
      streamUrl: streamUrlTv(lr.tmdbId, season, ep.episode_number),
    },
  };
}

async function jumpTmdbSeason(lr, targetSeason) {
  const details = await getTvDetails(lr.tmdbId);
  if (targetSeason > details.number_of_seasons || targetSeason < 1) return null;
  const seasonData = await getSeasonDetails(lr.tmdbId, targetSeason);
  const ep = seasonData.episodes[0];
  return {
    kind: "result",
    result: {
      ok: true, mediaType: "tv", tmdbId: lr.tmdbId, showTitle: details.name,
      season: targetSeason, episode: ep.episode_number, episodeTitle: ep.name,
      totalSeasons: details.number_of_seasons,
      seasonEpisodes: seasonData.episodes.map((e) => ({ episode: e.episode_number, title: e.name })),
      streamUrl: streamUrlTv(lr.tmdbId, targetSeason, ep.episode_number),
    },
  };
}

// ============================================================
// Fallback path — no TMDB_API_KEY set, uses the hardcoded/Supabase library
// ============================================================
async function handleFallback(query, context) {
  const library = await getLibrary();

  const followup = tryFollowup(library, query, context);
  if (followup) {
    if (followup.type === "result" && followup.result) {
      return NextResponse.json({ kind: "result", result: followup.result });
    }
    if (followup.type === "suggestion") {
      const { text, slugs } = buildSuggestionReply(library, context?.lastSuggestionSlugs || []);
      return NextResponse.json({ kind: "suggestion", text, slugs });
    }
  }

  if (isSuggestionQuery(query)) {
    const { text, slugs } = buildSuggestionReply(library, context?.lastSuggestionSlugs || []);
    return NextResponse.json({ kind: "suggestion", text, slugs });
  }

  const result = resolveQuery(library, query);
  if (result.ok) return NextResponse.json({ kind: "result", result });

  const hasEpisodeMarkers = /s\d{1,2}\s*e\d{1,3}|\d{1,2}x\d{1,3}|season\s*\d|episode\s*\d|finale|pilot/i.test(query);
  if (!hasEpisodeMarkers) {
    const { text, slugs } = buildSuggestionReply(library, context?.lastSuggestionSlugs || []);
    return NextResponse.json({ kind: "fallback-suggestion", text, slugs });
  }

  return NextResponse.json({ kind: "no-match" });
}
