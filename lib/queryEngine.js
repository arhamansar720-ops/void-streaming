export function normalize(q) {
  return (q || "").toLowerCase().replace(/[^\w\s]/g, "").trim();
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

export function extractSeasonEpisode(text) {
  let season = null, episode = null, finale = false;
  let m = text.match(/s(?:eason)?\s*(\d{1,2})\s*[, ]*\s*e(?:p(?:isode)?)?\s*(\d{1,3})/);
  if (!m) m = text.match(/(\d{1,2})x(\d{1,3})/);
  if (m) {
    season = parseInt(m[1]); episode = parseInt(m[2]);
    text = text.replace(m[0], "");
    return { season, episode, finale, text };
  }
  const sOnly = text.match(/season\s*(\d{1,2})/);
  if (sOnly) { season = parseInt(sOnly[1]); text = text.replace(sOnly[0], ""); }
  const eOnly = text.match(/ep(?:isode)?\s*(\d{1,3})/);
  if (eOnly) { episode = parseInt(eOnly[1]); text = text.replace(eOnly[0], ""); }
  if (/finale/.test(text)) { finale = true; text = text.replace("finale", ""); }
  if (/pilot|first episode/.test(text)) { episode = 1; season = season || 1; }
  return { season, episode, finale, text };
}

export function matchShow(library, remainderText) {
  const text = remainderText.trim();
  if (!text || text.length < 3) return null;
  let best = null, bestScore = Infinity;
  library.shows.forEach((show) => {
    const t = normalize(show.title);
    const score =
      text.length >= 4 && (t.includes(text) || text.includes(t))
        ? Math.abs(t.length - text.length) * 0.3
        : levenshtein(t, text);
    if (score < bestScore) { bestScore = score; best = show; }
  });
  const threshold = Math.max(3, Math.floor(text.length * 0.55));
  return bestScore <= threshold ? best : null;
}

function streamUrlFor(show, season, episode) {
  return `https://www.vidking.net/embed/tv/${show.tmdbId}/${season}/${episode}`;
}

export function resolveQuery(library, raw) {
  const norm = normalize(raw);
  const { season, episode, finale, text } = extractSeasonEpisode(norm);
  const show = matchShow(library, text);
  if (!show) return { ok: false };

  let s = season, e = episode;
  if (finale) {
    const last = show.seasons[show.seasons.length - 1];
    s = last.season; e = last.episodes.length;
  }
  if (!s) s = 1;
  const seasonObj = show.seasons.find((x) => x.season === s) || show.seasons[0];
  if (!e) e = 1;
  const epObj = seasonObj.episodes.find((x) => x.episode === e) || seasonObj.episodes[0];

  return {
    ok: true,
    showSlug: show.slug,
    showTitle: show.title,
    season: seasonObj.season,
    episode: epObj.episode,
    episodeTitle: epObj.title,
    totalSeasons: show.seasons.length,
    seasonEpisodes: seasonObj.episodes,
    streamUrl: streamUrlFor(show, seasonObj.season, epObj.episode),
  };
}

const SUGGEST_PATTERNS = [
  /what (should|can|do|would) i watch/, /what.?s good to watch/, /what.?s worth watching/,
  /recommend/, /suggest/, /any (suggestions|ideas|recommendations|recs)/,
  /what.?s on/, /something to watch/, /something good/, /something decent/,
  /something interesting/, /something fun/, /something new/, /something different/,
  /i.?m bored/, /i.?m not sure what to watch/, /help me (find|pick|choose|decide)/,
  /what to watch/, /watch tonight/, /tonight/, /anything good/, /good (movie|show|series)/,
  /pick (me )?something/, /give me something/, /not sure what to watch/,
  /no idea what to watch/, /watch something/, /find me something/,
  /show me something/, /surprise me/, /i don.?t know what to watch/,
  /i can.?t decide/, /what.?s good/, /top picks/, /best (shows|movies)/,
  /i need (a|something to) watch/, /got anything/, /what do you got/,
  /what.?s playing/, /what.?s popular/, /trending/, /what.?s new/,
];

export function isSuggestionQuery(raw) {
  const t = normalize(raw);
  if (SUGGEST_PATTERNS.some((p) => p.test(t))) return true;
  const hasEpisodeMarkers = /s\d{1,2}\s*e\d{1,3}|\d{1,2}x\d{1,3}|season\s*\d|episode\s*\d|finale|pilot/.test(t);
  if (hasEpisodeMarkers) return false;
  const askWords = /^(what|something|anything|any|help|idea|ideas|got|give|find|show|recommend|suggest|pick|i)\b/.test(t);
  const watchWords = /\bwatch|watching|view|viewing|stream|streaming|tonight|bored|decide|recs?\b/.test(t);
  return askWords && watchWords;
}

export function buildSuggestionReply(library, excludeSlugs = []) {
  const pool = library.shows.filter((s) => !excludeSlugs.includes(s.slug));
  const usePool = pool.length >= 3 ? pool : library.shows;
  const picks = [...usePool].sort(() => Math.random() - 0.5).slice(0, 3);
  const lines = picks.map((s) => `${s.title} — try "${s.title.toLowerCase()} season 1 episode 1"`);
  return {
    text: `Here's what's in the library right now: ${lines.join(" · ")}.`,
    slugs: picks.map((p) => p.slug),
  };
}

const FOLLOWUP_NEXT = /^(next|next episode|next one|continue|keep going|play next|play the next one|next ep)\b/;
const FOLLOWUP_PREV = /^(previous|last episode|go back|prior episode|back one)\b/;
const FOLLOWUP_ANOTHER = /^(another|something else|different one|not (that|this)|skip (this|that)|none of (those|these)|other options?)\b/;
const FOLLOWUP_SEASON_ONLY = /^(what about |try |go to |switch to )?season\s*(\d{1,2})$/;

function stepEpisode(library, prevResult, dir) {
  const show = library.shows.find((s) => s.slug === prevResult.showSlug);
  if (!show) return null;
  let seasonIdx = show.seasons.findIndex((s) => s.season === prevResult.season);
  let seasonObj = show.seasons[seasonIdx];
  let epIdx = seasonObj.episodes.findIndex((e) => e.episode === prevResult.episode) + dir;

  if (epIdx >= seasonObj.episodes.length) {
    if (seasonIdx + 1 < show.seasons.length) { seasonIdx++; seasonObj = show.seasons[seasonIdx]; epIdx = 0; }
    else epIdx = seasonObj.episodes.length - 1;
  } else if (epIdx < 0) {
    if (seasonIdx - 1 >= 0) { seasonIdx--; seasonObj = show.seasons[seasonIdx]; epIdx = seasonObj.episodes.length - 1; }
    else epIdx = 0;
  }
  const ep = seasonObj.episodes[epIdx];
  return {
    ok: true,
    showSlug: show.slug,
    showTitle: show.title,
    season: seasonObj.season,
    episode: ep.episode,
    episodeTitle: ep.title,
    totalSeasons: show.seasons.length,
    seasonEpisodes: seasonObj.episodes,
    streamUrl: streamUrlFor(show, seasonObj.season, ep.episode),
  };
}

/**
 * Checks the raw query against conversation context (last result watched,
 * last suggestions given) before falling back to a fresh search.
 * Returns null if it's not a follow-up at all.
 */
export function tryFollowup(library, raw, context) {
  const t = normalize(raw);

  if (FOLLOWUP_NEXT.test(t) && context?.lastResult) {
    return { type: "result", result: stepEpisode(library, context.lastResult, 1) };
  }
  if (FOLLOWUP_PREV.test(t) && context?.lastResult) {
    return { type: "result", result: stepEpisode(library, context.lastResult, -1) };
  }
  if (FOLLOWUP_ANOTHER.test(t) && context?.lastSuggestionSlugs?.length) {
    return { type: "suggestion" };
  }
  const seasonOnly = t.match(FOLLOWUP_SEASON_ONLY);
  if (seasonOnly && context?.lastResult) {
    const show = library.shows.find((s) => s.slug === context.lastResult.showSlug);
    const targetSeason = parseInt(seasonOnly[2]);
    const seasonObj = show?.seasons.find((s) => s.season === targetSeason);
    if (seasonObj) {
      const ep = seasonObj.episodes[0];
      return {
        type: "result",
        result: {
          ok: true,
          showSlug: show.slug,
          showTitle: show.title,
          season: seasonObj.season,
          episode: ep.episode,
          episodeTitle: ep.title,
          totalSeasons: show.seasons.length,
          seasonEpisodes: seasonObj.episodes,
          streamUrl: streamUrlFor(show, seasonObj.season, ep.episode),
        },
      };
    }
  }
  return null;
}
