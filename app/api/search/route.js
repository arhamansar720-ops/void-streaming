import { NextResponse } from "next/server";
import { catalog } from "@/lib/catalog";
import { understand } from "@/lib/brain";
import { getLibrary } from "@/lib/library";
import { resolveQuery, tryFollowup, buildSuggestionReply } from "@/lib/queryEngine";

// Response shapes:
//   { kind: "result", reply, result }
//   { kind: "suggestion", reply, suggestions: [{ title, type, year, query }], rec }
//   { kind: "chat", reply }
//   { kind: "no-match", reply }

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ kind: "chat", reply: "That didn't come through — try again." }, { status: 400 });
  }
  const { query } = body || {};
  const context = body?.context || {};
  const history = Array.isArray(body?.history) ? body.history : [];
  if (!query || typeof query !== "string") {
    return NextResponse.json({ kind: "chat", reply: "Type something to watch." }, { status: 400 });
  }

  try {
    const intent = await understand(query.slice(0, 300), history, context);
    return NextResponse.json(await act(intent, query, context));
  } catch (err) {
    console.error("search failed, using offline library:", err.message);
    return NextResponse.json(await offline(query, context));
  }
}

async function act(intent, raw, context) {
  const lr = context.lastResult;

  if (intent.intent === "step" && lr?.mediaType === "tv") {
    return stepEpisode(lr, intent.dir === -1 ? -1 : 1, intent.reply);
  }

  if (intent.intent === "recommend") return recommend(intent, context);

  if (intent.intent === "play") {
    // Season/episode with no title → the show that's on screen
    if ((intent.useCurrent || !intent.title) && lr?.mediaType === "tv") {
      const show = await catalog.show({ tmdbId: lr.tmdbId, imdbId: lr.imdbId, type: "tv", title: lr.title });
      return playShow(show, intent, intent.reply);
    }
    if (intent.title) return play(intent, raw);
  }

  return { kind: "chat", reply: intent.reply || "Tell me a show, a movie, or a mood." };
}

// ---------------- playback ----------------
async function play(intent, raw) {
  const opts = { type: intent.type, year: intent.year };
  let item = await catalog.findOne(intent.title, opts);
  // Rule parser strips words like "show"/"now" — retry with the untouched text if that broke the title.
  if (!item && intent.via === "rules") item = await catalog.findOne(raw.replace(/s\d+\s*e\d+/i, ""), opts).catch(() => null);
  if (!item) {
    return { kind: "no-match", reply: `Couldn't find "${intent.title}". Check the spelling, or describe it and I'll guess.` };
  }
  if (item.type === "movie") {
    const m = await catalog.movie(item);
    if (!m.tmdbId) return unplayable(m.title);
    return {
      kind: "result",
      reply: intent.reply || `Playing ${m.title}${m.year ? ` (${m.year})` : ""}.`,
      result: { mediaType: "movie", tmdbId: m.tmdbId, imdbId: m.imdbId, showTitle: m.title, year: m.year, backdrop: m.backdrop, poster: m.poster },
    };
  }
  return playShow(await catalog.show(item), intent, intent.reply);
}

async function playShow(show, { season, episode, which }, reply) {
  if (!show.tmdbId) return unplayable(show.title);
  const nums = show.seasonNums.length ? show.seasonNums : [1];
  let s = season;
  if (which === "finale" || which === "lastSeason") s = s || nums[nums.length - 1];
  if (which === "pilot") { s = s || 1; episode = 1; }
  if (!nums.includes(s)) {
    if (s) {
      const eps = await show.loadSeason(nums[0]);
      return { ...(build(show, nums[0], eps, 1)), reply: `${show.title} only has ${nums.length} season${nums.length > 1 ? "s" : ""} — starting from the top.` };
    }
    s = nums[0];
  }
  const eps = await show.loadSeason(s);
  let e = episode || 1;
  if (which === "finale") e = eps[eps.length - 1]?.episode || 1;
  if (episode && !eps.some((x) => x.episode === episode)) {
    return { ...(build(show, s, eps, eps[eps.length - 1]?.episode || 1)), reply: `Season ${s} only goes to episode ${eps.length} — here's the last one.` };
  }
  return build(show, s, eps, e, reply);
}

function build(show, s, eps, e, reply) {
  const ep = eps.find((x) => x.episode === e) || eps[0] || { episode: e, title: `Episode ${e}` };
  return {
    kind: "result",
    reply: reply || `${show.title} — S${s}E${ep.episode}${ep.title && !/^Episode \d+$/.test(ep.title) ? `, "${ep.title}"` : ""}.`,
    result: {
      mediaType: "tv",
      tmdbId: show.tmdbId,
      imdbId: show.imdbId,
      showTitle: show.title,
      backdrop: show.backdrop,
      poster: show.poster,
      season: s,
      episode: ep.episode,
      episodeTitle: ep.title,
      totalSeasons: show.seasonNums.length || 1,
      seasonEpisodes: eps,
    },
  };
}

async function stepEpisode(lr, dir, reply) {
  const show = await catalog.show({ tmdbId: lr.tmdbId, imdbId: lr.imdbId, type: "tv", title: lr.title });
  const nums = show.seasonNums.length ? show.seasonNums : [lr.season];
  let s = lr.season;
  let eps = await show.loadSeason(s);
  let idx = eps.findIndex((x) => x.episode === lr.episode) + dir;
  if (idx >= eps.length) {
    const ns = nums[nums.indexOf(s) + 1];
    if (!ns) return { ...build(show, s, eps, lr.episode), reply: `That's the last episode of ${show.title} — want something like it?` };
    s = ns; eps = await show.loadSeason(s); idx = 0;
  } else if (idx < 0) {
    const ps = nums[nums.indexOf(s) - 1];
    if (!ps) return { ...build(show, s, eps, lr.episode), reply: "Already at the very first episode." };
    s = ps; eps = await show.loadSeason(s); idx = eps.length - 1;
  }
  return build(show, s, eps, eps[idx].episode, reply);
}

function unplayable(title) {
  return { kind: "no-match", reply: `Found ${title}, but none of the servers carry it yet. Try another title.` };
}

// ---------------- recommendations ----------------
async function recommend(intent, context) {
  // Skip anything already pitched this session or already in the viewer's watch history.
  const seen = new Set([...(context.suggested || []), ...(intent.similarTo ? [] : context.watched || [])].map((t) => String(t).toLowerCase()));
  const rec = { genre: intent.genre || null, type: intent.type || null, similarTo: intent.similarTo || null };
  let picks = [];

  if (intent.recs?.length) {
    // LLM-picked titles: confirm each one exists before showing it.
    const found = await Promise.all(
      intent.recs.slice(0, 6).map((r) => catalog.findOne(r.title, { type: r.type, year: r.year }).catch(() => null))
    );
    picks = found.filter(Boolean);
  }

  if (picks.length < 3) {
    let pool = [];
    if (rec.similarTo) {
      const base = await catalog.findOne(rec.similarTo).catch(() => null);
      if (base) {
        const full = base.type === "movie" ? await catalog.movie(base) : await catalog.show(base);
        pool = await catalog.similar({ ...base, ...full });
        rec.basedOn = full.title;
      }
    }
    if (!pool.length) pool = await catalog.discover({ type: rec.type, genre: rec.genre });
    picks = [...picks, ...shuffle(pool.filter((p) => !seen.has(p.title.toLowerCase())).slice(0, 16))];
  }

  const unique = [];
  for (const p of picks) {
    const key = p.title.toLowerCase();
    if (seen.has(key) || unique.some((u) => u.title.toLowerCase() === key)) continue;
    unique.push(p);
    if (unique.length === 4) break;
  }
  if (!unique.length) return { kind: "chat", reply: "I've run out of fresh picks for that — try a different mood or genre." };

  const what = [rec.genre?.toLowerCase(), rec.type === "movie" ? "movies" : rec.type === "tv" ? "shows" : "picks"].filter(Boolean).join(" ");
  const reply =
    intent.reply ||
    (rec.basedOn ? `If you liked ${rec.basedOn}, try one of these.` : intent.more ? "Here's another batch." : rec.genre || rec.type ? `A few ${what} worth a shot:` : "Popular right now:");

  return {
    kind: "suggestion",
    reply,
    rec,
    suggestions: unique.map((p) => ({
      title: p.title,
      type: p.type,
      year: p.year,
      query: `${p.title}${p.year ? ` ${p.year}` : ""}${p.type === "movie" ? " movie" : ""}`,
    })),
  };
}

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------- last resort: hardcoded library ----------------
async function offline(query, context) {
  const library = await getLibrary();
  const follow = tryFollowup(library, query, { lastResult: context.lastResult, lastSuggestionSlugs: [] });
  if (follow?.type === "result" && follow.result) return { kind: "result", reply: "Here you go.", result: follow.result };
  const r = resolveQuery(library, query);
  if (r.ok) return { kind: "result", reply: `${r.showTitle} — S${r.season}E${r.episode}.`, result: r };
  const { text } = buildSuggestionReply(library, []);
  return { kind: "chat", reply: `The catalog is having a moment, so search is limited. ${text}` };
}
