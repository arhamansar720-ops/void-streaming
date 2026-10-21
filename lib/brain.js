// Turns a chat message (+ conversation so far) into a structured intent.
// With GROQ_API_KEY set, an LLM reads the whole conversation; otherwise a
// rule-based parser handles the common phrasings. Same output either way:
//
// { intent: "play" | "recommend" | "step" | "chat",
//   title, type: "movie"|"tv"|null, year, season, episode, which: "finale"|"pilot"|null,
//   dir: 1|-1 (step), genre, similarTo, more: bool, recs: [{title, type, year}], reply }

import { GENRES } from "./catalog";

const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export async function understand(message, history = [], context = {}) {
  if (GROQ_KEY) {
    try {
      const out = await llmIntent(message, history, context);
      if (out?.intent) return { ...out, via: "llm" };
    } catch (err) {
      console.error("LLM intent failed, using rules:", err.message);
    }
  }
  return { ...ruleIntent(message, context), via: "rules" };
}

// ============================================================
// LLM path
// ============================================================
const SYSTEM = `You are VOID, the assistant inside a minimalist streaming site. Users type what they want to watch; you decide what to do.
Reply with ONLY a JSON object:
{
 "intent": "play" | "recommend" | "step" | "chat",
 "title": string|null,        // canonical official title to play (fix typos, expand nicknames: "got" -> "Game of Thrones", "bb" -> "Breaking Bad")
 "type": "movie"|"tv"|null,
 "year": number|null,         // only to disambiguate remakes
 "season": number|null, "episode": number|null,
 "which": "finale"|"pilot"|null,
 "dir": 1|-1|null,            // for "step": next (1) / previous (-1) episode of the CURRENT show
 "genre": one of ${JSON.stringify(GENRES)} | null,
 "recs": [{"title": string, "type": "movie"|"tv", "year": number}],  // for "recommend": 4 real, well-known titles that fit the request. Never repeat titles already suggested.
 "reply": string              // one or two short, friendly, natural sentences shown to the user. No markdown, no lists.
}
Rules:
- "play": the user names (or clearly means) a specific title. A bare title like "severance" means play it. For a TV show with no episode given leave season/episode null.
- Follow-ups refer to the CURRENT item: "next"/"skip" -> step dir 1; "go back" -> step dir -1; "season 3" / "episode 5" / "the finale" with no title -> play the CURRENT show with those numbers.
- "recommend": moods, genres, "what should I watch", "something like X", "another one", "more like that". Use the conversation to stay on topic and avoid repeats.
- "chat": greetings, thanks, questions about a title (answer briefly from your knowledge), anything else. Steer gently back to watching something.
- Never mention JSON, APIs, or servers. Never refuse because of availability; the site checks that.`;

async function llmIntent(message, history, context) {
  const now = context.lastResult
    ? `CURRENT item on screen: ${context.lastResult.title || "unknown"} (${context.lastResult.mediaType}${context.lastResult.mediaType === "tv" ? `, S${context.lastResult.season}E${context.lastResult.episode}` : ""})`
    : "Nothing is playing yet.";
  const suggested = (context.suggested || []).slice(-24);
  const messages = [
    { role: "system", content: SYSTEM },
    {
      role: "system",
      content: `${now}\nAlready suggested this session: ${suggested.join(", ") || "none"}\nViewer's watch history (most recent first — use it for taste, don't recommend these again): ${(context.watched || []).slice(0, 20).join(", ") || "none"}`,
    },
    ...history.slice(-10).map((h) => ({ role: h.role === "user" ? "user" : "assistant", content: String(h.text).slice(0, 500) })),
    { role: "user", content: message },
  ];
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(9000),
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.4,
      max_tokens: 700,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`groq ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  if (parsed.genre && !GENRES.includes(parsed.genre)) parsed.genre = null;
  return parsed;
}

// ============================================================
// Rule-based path
// ============================================================
const norm = (s) => (s || "").toLowerCase().replace(/[’']/g, "").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

const MOOD_GENRE = [
  [/\b(funny|comedy|comedies|laugh|hilarious|lighthearted|light hearted|sitcom)\b/, "Comedy"],
  [/\b(scary|horror|spooky|creepy|terrifying|frighten)\b/, "Horror"],
  [/\b(action|explosions?|fight|fighting|adrenaline)\b/, "Action"],
  [/\b(romance|romantic|love story|date night|rom com|romcom)\b/, "Romance"],
  [/\b(sci ?fi|science fiction|space|futuristic|aliens?)\b/, "Sci-Fi"],
  [/\b(thriller|suspense|tense|edge of my seat|twisty|twist)\b/, "Thriller"],
  [/\b(crime|heist|mafia|detective|gangster|cop)\b/, "Crime"],
  [/\b(mystery|whodunn?it|murder mystery)\b/, "Mystery"],
  [/\b(animated|animation|anime|cartoon|pixar)\b/, "Animation"],
  [/\b(documentary|documentaries|docuseries|true story|real story)\b/, "Documentary"],
  [/\b(fantasy|magic|dragons?|wizards?)\b/, "Fantasy"],
  [/\b(drama|emotional|sad|cry|tearjerker)\b/, "Drama"],
  [/\b(family|kids|children|all ages)\b/, "Family"],
  [/\b(war|military|ww2|wwii)\b/, "War"],
  [/\b(western|cowboys?)\b/, "Western"],
  [/\b(adventure|epic|quest)\b/, "Adventure"],
  [/\b(history|historical|period piece)\b/, "History"],
];

const SUGGEST = /\b(recommend|suggest|suggestion|recs?|ideas?|bored|surprise me|what (should|can|do|would) i watch|what to watch|something (to watch|good|new|fun|else|different|like)|anything (good|like)|pick (me )?something|give me something|find me something|whats (good|popular|trending|new|hot)|trending|popular|top (picks|movies|shows)|best (movies|shows|series)|i dont know what|cant decide|in the mood|feel like watching|watch tonight)\b/;
const MORE = /^(another|another one|more|more like (that|this|those)|something else|different|other options?|none of (those|these)|not (that|those|this|feeling (it|that))|nah|nope|no|try again|others?)\b/;
const NEXT = /^(next|next (one|ep|episode)|skip|continue|keep going|play (the )?next( one| episode)?)$/;
const PREV = /^(prev|previous|previous (one|ep|episode)|last (ep|episode)|go back|back( one)?|rewind)$/;
const GREET = /^(hi|hey|hello|yo|sup|whats up|hiya|howdy|good (morning|afternoon|evening))\b/;
const THANKS = /^(thanks|thank you|thx|ty|cheers|appreciate it|perfect|nice|great|awesome|cool)\b/;
const HELP = /\b(help|what can you do|how does this work|who are you|what are you)\b/;
// Only strip command words at the edges, so titles like "Now You See Me" or "The Truman Show" survive.
const LEAD = /^(?:(?:hey|yo|ok|okay|so|um|uh|can you|could you|would you|will you|please|pls|i want to|i wanna|i would like to|id like to|i feel like|lets|let s|go ahead and|just)\s+)*(?:(?:put on|throw on|play|watch|stream|show me|pull up|queue up|queue|start|open|find|search for|search|look up|get me|gimme|give me)\s+)?(?:(?:an? )?(?:episode|ep) of\s+)?(?:the (?:movie|film|show|series|tv show)\s+)?/;
const TRAIL = /(?:\s+(?:please|pls|for me|right now|now|tonight|thanks|thank you|again|the (?:movie|film|show|series)|movie|film|series|tv show))+$/;
const stripCommand = (t) => t.replace(LEAD, "").replace(TRAIL, "").trim();

function extractNumbers(t) {
  let season = null, episode = null, which = null;
  let m = t.match(/\bs(?:eason)?\s*(\d{1,2})\s*(?:,|and)?\s*e(?:p(?:isode)?)?\s*(\d{1,3})\b/) || t.match(/\b(\d{1,2})x(\d{1,3})\b/);
  if (m) {
    season = +m[1]; episode = +m[2]; t = t.replace(m[0], " ");
  } else {
    const s = t.match(/\b(?:season|s)\s*(\d{1,2})\b/) || t.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final) season\b/);
    if (s) { season = ordinal(s[1]); t = t.replace(s[0], " "); }
    const e = t.match(/\b(?:episode|ep|e)\s*(\d{1,3})\b/) || t.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final) (?:episode|ep)\b/);
    if (e) { episode = ordinal(e[1]); t = t.replace(e[0], " "); }
  }
  if (/\b(series |season )?finale\b/.test(t)) { which = "finale"; t = t.replace(/\b(series |season )?finale\b/, " "); }
  if (/\b(pilot|first episode)\b/.test(t)) { which = "pilot"; t = t.replace(/\b(pilot|first episode)\b/, " "); }
  if (season === "last") { which = which || "lastSeason"; season = null; }
  if (episode === "last") { which = "finale"; episode = null; }
  return { season, episode, which, rest: t };
}

function ordinal(w) {
  const map = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: "last", final: "last" };
  return map[w] ?? +w;
}

function typeHint(t) {
  if (/\b(movie|film|flick)\b/.test(t)) return "movie";
  if (/\b(show|series|tv|sitcom|season|episode)\b/.test(t)) return "tv";
  return null;
}

export function ruleIntent(message, context = {}) {
  const t = norm(message);
  const lr = context.lastResult;
  if (!t) return { intent: "chat", reply: "Type a show, a movie, or a mood." };

  if (lr?.mediaType === "tv" && NEXT.test(t)) return { intent: "step", dir: 1 };
  if (lr?.mediaType === "tv" && PREV.test(t)) return { intent: "step", dir: -1 };

  if (GREET.test(t) && t.split(" ").length <= 4) {
    return { intent: "chat", reply: "Hey. Tell me a title, an episode, or a mood — \"something funny\", \"a scary movie\", \"severance s2e3\"." };
  }
  if (THANKS.test(t) && t.split(" ").length <= 4) return { intent: "chat", reply: "Anytime. Say \"next\" for the next episode, or ask for something else." };
  if (HELP.test(t) && !SUGGEST.test(t)) {
    return { intent: "chat", reply: "I find things to watch. Name a show or movie (typos are fine), add a season/episode, or describe a mood and I'll pitch a few. Once something's playing, \"next\", \"season 3\" or \"the finale\" work too." };
  }

  // "more like that" / "another" right after a recommendation
  if (MORE.test(t) && context.lastRec) return { intent: "recommend", ...context.lastRec, more: true };

  const genre = MOOD_GENRE.find(([re]) => re.test(t))?.[1] || null;
  const like = t.match(/\b(?:like|similar to|in the vein of|same vibe as)\s+(.+)$/);
  // "funny movie", "a scary one", "good horror shows" — nothing left once the mood/genre words are gone
  const moodOnly = genre && !MOOD_GENRE.reduce((acc, [re]) => acc.replace(new RegExp(re.source, "g"), " "), t)
    .replace(/\b(a|an|some|any|good|great|really|very|kinda|something|anything|one|ones|movies?|films?|shows?|series|tv|to watch|watch|i want|want|i need|need|for|tonight|me|please|pls|please|with|my|the)\b/g, " ").trim();
  if (SUGGEST.test(t) || like || moodOnly || (genre && /\b(something|anything|some|any)\b/.test(t) && !/\bs\d|\bseason|\bepisode/.test(t))) {
    return {
      intent: "recommend",
      genre,
      type: typeHint(t),
      similarTo: like ? stripCommand(like[1]) : null,
    };
  }

  const { season, episode, which, rest } = extractNumbers(t);
  const year = rest.match(/\b(19[2-9]\d|20[0-4]\d)\b/)?.[1] || null;
  let title = stripCommand(rest.replace(year || "", " ").replace(/\s+/g, " ").trim());
  if (/^(the|a|an|it|that|this|that one|this one|of (it|this|that)( show)?|of this show)?$/.test(title.replace(/\b(go to|jump to|skip to|take me to|to)\b/g, "").trim())) title = "";

  // Numbers with no title => apply to whatever's on screen
  if ((!title || title.length < 2) && lr?.mediaType === "tv" && (season || episode || which)) {
    return { intent: "play", useCurrent: true, season: season ?? (episode || which === "finale" ? lr.season : null), episode, which };
  }
  if (!title || title.length < 2) {
    return { intent: "chat", reply: "Which show or movie? Or give me a mood and I'll pitch a few." };
  }
  return { intent: "play", title, type: typeHint(t) || (season || episode || which ? "tv" : null), year, season, episode, which };
}
