"use client";
import { useEffect, useRef, useState } from "react";
import Starfield from "@/components/Starfield";
import RingParticle from "@/components/RingParticle";
import WaveDivider from "@/components/WaveDivider";
import Player from "@/components/Player";
import { AnimatePresence, motion } from "motion/react";
import BlurText from "@/components/reactbits/BlurText";
import SpotlightCard from "@/components/reactbits/SpotlightCard";

const PLACEHOLDER_PHRASES = [
  "dexter season 3 episode 2",
  "something funny for tonight",
  "the office s2 e1",
  "something like breaking bad",
  "severance",
  "a scary movie",
];

const EXAMPLE_CHIPS = [
  { label: "DEXTER S3E2", q: "Dexter season 3 episode 2" },
  { label: "BREAKING BAD FINALE", q: "breaking bad finale" },
  { label: "SOMETHING FUNNY", q: "something funny" },
  { label: "LIKE SEVERANCE", q: "something like severance" },
];

function readStore(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bubbleSeq = 0;

export default function Page() {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [placeholder, setPlaceholder] = useState("");
  const [thread, setThread] = useState([]); // {id, role, text, found, error, suggestions}
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  const [result, setResult] = useState(null); // current rendered result
  const [recall, setRecall] = useState(null);
  const [watchlistLabel, setWatchlistLabel] = useState("+ Watchlist");

  // Conversation memory sent with every request so follow-ups ("next", "another one") resolve.
  const contextRef = useRef({ lastResult: null, lastRec: null, suggested: [] });
  const historyRef = useRef([]); // [{role, text}]
  const inputRef = useRef(null);
  const resultRef = useRef(null);
  const threadEndRef = useRef(null);

  // typewriter placeholder
  useEffect(() => {
    let phIndex = 0, charIndex = 0, deleting = false, timeoutId;

    function tick() {
      if (document.activeElement === inputRef.current || query) {
        timeoutId = setTimeout(tick, 400);
        return;
      }
      const phrase = PLACEHOLDER_PHRASES[phIndex];
      if (!deleting) {
        charIndex++;
        setPlaceholder(phrase.slice(0, charIndex));
        if (charIndex >= phrase.length) { deleting = true; timeoutId = setTimeout(tick, 1400); return; }
        timeoutId = setTimeout(tick, 55);
      } else {
        charIndex--;
        setPlaceholder(phrase.slice(0, charIndex));
        if (charIndex <= 0) { deleting = false; phIndex = (phIndex + 1) % PLACEHOLDER_PHRASES.length; timeoutId = setTimeout(tick, 300); return; }
        timeoutId = setTimeout(tick, 28);
      }
    }
    tick();
    return () => clearTimeout(timeoutId);
  }, [query]);

  // load continue-watching from localStorage on mount
  useEffect(() => {
    setRecall(readStore("void_continue", null));
  }, []);

  // auto-scroll down to the player once a result is actually rendered
  useEffect(() => {
    if (result && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  useEffect(() => {
    if (!result) threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [thread, result]);

  function addBubble(text, opts = {}) {
    const id = ++bubbleSeq;
    setThread((prev) => [...prev, { id, text, ...opts }]);
    return id;
  }

  function patchBubble(id, patch) {
    setThread((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  // Types a reply into its own bubble (by id, so overlapping replies can't clobber each other).
  async function typeBubble(text, opts = {}) {
    const id = addBubble("", opts);
    const stepSize = Math.max(1, Math.ceil(text.length / 90));
    for (let i = stepSize; i < text.length + stepSize; i += stepSize) {
      await wait(14);
      patchBubble(id, { text: text.slice(0, i) });
    }
    return id;
  }

  function remember(role, text) {
    historyRef.current = [...historyRef.current, { role, text }].slice(-12);
  }

  async function ask(raw) {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: raw, context: contextRef.current, history: historyRef.current }),
    });
    return res.json();
  }

  async function runQuery(raw, { silent = false } = {}) {
    raw = (raw || "").trim();
    if (!raw || busy) return;
    setBusy(true);
    setQuery("");
    setRecall(null);
    if (!silent) addBubble(raw, { role: "user" });
    remember("user", raw);
    const pending = addBubble("Thinking…", { pending: true });

    let data;
    try {
      data = await ask(raw);
    } catch {
      setThread((prev) => prev.filter((b) => b.id !== pending));
      await typeBubble("Couldn't reach the search service — check your connection and try again.", { error: true });
      setBusy(false);
      return;
    }
    setThread((prev) => prev.filter((b) => b.id !== pending));

    const reply = data.reply || "";
    remember("assistant", reply + (data.suggestions ? ` [suggested: ${data.suggestions.map((s) => s.title).join(", ")}]` : ""));

    if (data.kind === "result") {
      await typeBubble(reply, { found: true });
      renderResult(data.result);
    } else if (data.kind === "suggestion") {
      contextRef.current.lastRec = data.rec || null;
      contextRef.current.suggested = [...contextRef.current.suggested, ...data.suggestions.map((s) => s.title)].slice(-40);
      await typeBubble(reply, { found: true });
      addBubble("", { suggestions: data.suggestions });
      setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    } else {
      await typeBubble(reply || "Not sure what you meant — try a title or a mood.", { error: data.kind === "no-match" });
    }
    setBusy(false);
    inputRef.current?.focus({ preventScroll: true });
  }

  function renderResult(r) {
    contextRef.current.lastResult = {
      mediaType: r.mediaType, tmdbId: r.tmdbId, imdbId: r.imdbId, title: r.showTitle,
      ...(r.mediaType === "tv" ? { season: r.season, episode: r.episode, showSlug: r.showSlug } : {}),
    };
    setResult(r);
    setStep(2);

    writeStore("void_continue", r.mediaType === "movie"
      ? { mediaType: "movie", tmdbId: r.tmdbId, title: r.showTitle, year: r.year }
      : { mediaType: "tv", tmdbId: r.tmdbId, season: r.season, episode: r.episode, title: r.showTitle, episodeTitle: r.episodeTitle });
  }

  // Episode strip / season pills: ask in context so the server resolves against the show on screen.
  async function jumpTo(text) {
    if (!result || busy) return;
    setBusy(true);
    try {
      const data = await ask(text);
      if (data.kind === "result") renderResult(data.result);
    } catch {
      /* silent — strip click is a convenience action, main search path still works */
    }
    setBusy(false);
  }

  function resetToConsole() {
    setResult(null);
    setThread([]);
    setQuery("");
    contextRef.current = { lastResult: null, lastRec: null, suggested: [] };
    historyRef.current = [];
    setStep(1);
    setRecall(readStore("void_continue", null));
    inputRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveWatchlist() {
    if (!result) return;
    const key = result.tmdbId ?? result.showSlug;
    const list = readStore("void_watchlist", []);
    if (!list.includes(key)) list.push(key);
    writeStore("void_watchlist", list);
    setWatchlistLabel("ADDED ✓");
    setTimeout(() => setWatchlistLabel("+ Watchlist"), 1400);
  }

  function onKeyDown(e) {
    if (e.key === "Enter") runQuery(query);
  }

  return (
    <main>
      <nav className="pillNav">
        <div className="word">VO<span>ID</span></div>
        <div className="sep" />
        <div className={`step ${step === 1 ? "active" : ""}`}>01 — SEARCH</div>
        <div className={`step ${step === 2 ? "active" : ""}`}>02 — PLAYBACK</div>
      </nav>

      <section className="view">
        <Starfield />
        <div className="heroGrid">
          <div className="heroLeft">
            <div className="eyebrow">01 — SEARCH</div>
            <h1 className="heroTitle">
              <BlurText text="Tonight's" delay={90} animateBy="letters" /><br />
              <BlurText text="the" delay={90} />{" "}<em><BlurText text="Night." delay={110} animateBy="letters" /></em>
            </h1>
            <p className="heroSub">
              No browsing, no rows, no menus — just say what you want. Name a show or an episode,
              describe a mood, or ask for something like a show you already love.
            </p>

            <div className={`inputShell ${focused ? "focused" : ""}`}>
              <div className="inputBar">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder={placeholder}
                  value={query}
                  autoComplete="off"
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                />
                <button className="goBtn" onClick={() => runQuery(query)} disabled={busy}>{busy ? "…" : "Find"}</button>
              </div>
            </div>

            <div className="examples">
              {EXAMPLE_CHIPS.map((c) => (
                <div key={c.label} className="chip" onClick={() => runQuery(c.q)}>
                  {c.label}
                </div>
              ))}
            </div>

            {recall && !result && (
              <div className="recall">
                <div className="label">Continue Watching</div>
                <div
                  className="recallChip"
                  onClick={() =>
                    runQuery(
                      recall.mediaType === "movie"
                        ? recall.title
                        : `${recall.title} season ${recall.season} episode ${recall.episode}`
                    )
                  }
                >
                  <div className="meta">
                    <b>{recall.title}</b>
                    <span>
                      {recall.mediaType === "movie"
                        ? `RESUME · ${recall.year || ""}`
                        : `RESUME · S${recall.season}E${recall.episode} — ${recall.episodeTitle}`}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <RingParticle />

        {thread.length > 0 && (
          <div className="threadView show">
            <AnimatePresence initial={false}>
              {thread.map((b) =>
                b.suggestions ? (
                  <motion.div
                    key={b.id}
                    className="suggestRow"
                    initial="hidden"
                    animate="show"
                    variants={{ show: { transition: { staggerChildren: 0.07 } } }}
                  >
                    {b.suggestions.map((sug) => (
                      <motion.div
                        key={sug.title + sug.year}
                        variants={{ hidden: { opacity: 0, y: 14, filter: "blur(6px)" }, show: { opacity: 1, y: 0, filter: "blur(0px)" } }}
                      >
                        <SpotlightCard as="button" className="suggestChip" onClick={() => runQuery(sug.query)} disabled={busy}>
                          <b>{sug.title}</b>
                          <span>{[sug.year, sug.type === "movie" ? "Film" : "Series"].filter(Boolean).join(" · ")}</span>
                        </SpotlightCard>
                      </motion.div>
                    ))}
                  </motion.div>
                ) : (
                  <motion.div
                    key={b.id}
                    layout="position"
                    initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.3 }}
                    className={`bubble ${b.role === "user" ? "user" : ""} ${b.found ? "found" : ""} ${b.error ? "error" : ""} ${b.pending ? "pending" : ""}`}
                  >
                    <span className="dot" />
                    <span>{b.text}</span>
                  </motion.div>
                )
              )}
            </AnimatePresence>
            <div ref={threadEndRef} />
          </div>
        )}
      </section>

      {result && (
        <section className="view">
          <div className="resultView show" ref={resultRef}>
            <div className="eyebrow" style={{ textAlign: "center", width: "100%" }}>02 — PLAYBACK</div>
            <div className="resultGrid">
              <div className="metaCol">
                <div className="show">{result.showTitle}</div>
                {result.mediaType === "movie" ? (
                  <>
                    <h2><BlurText key={result.tmdbId} text={result.year ? String(result.year) : "Movie"} delay={80} animateBy="letters" /></h2>
                    <div className="sub">Feature film</div>
                  </>
                ) : (
                  <>
                    <h2><BlurText key={`${result.tmdbId}-${result.season}-${result.episode}`} text={`S${result.season} · E${result.episode} — ${result.episodeTitle}`} delay={60} /></h2>
                    <div className="sub">Season {result.season} of {result.totalSeasons} · Episode {result.episode}</div>
                  </>
                )}
                <div className="metaActions">
                  <button className="pillBtn" onClick={resetToConsole}>New Search</button>
                  <button className="pillBtn primary" onClick={saveWatchlist}>{watchlistLabel}</button>
                </div>
                <WaveDivider />
              </div>
              <Player result={result} />
              <div className="playerNote">
                Some clicks inside the player may trigger a pop-up or redirect — that comes
                from the embed itself, not this app. Running an ad blocker like{" "}
                <a href="https://ublockorigin.com" target="_blank" rel="noopener noreferrer">uBlock Origin</a>
                {" "}(or using Brave, which has one built in) stops it cleanly.
              </div>
            </div>
            {result.mediaType === "tv" && result.totalSeasons > 1 && (
              <div className="seasonRow">
                {Array.from({ length: result.totalSeasons }, (_, i) => i + 1).map((n) => (
                  <button key={n} className={`seasonPill ${n === result.season ? "active" : ""}`} onClick={() => jumpTo(`season ${n}`)}>
                    S{n}
                  </button>
                ))}
              </div>
            )}
            {result.mediaType === "tv" && result.seasonEpisodes?.length > 0 && (
              <div className="epStrip">
                {result.seasonEpisodes.map((ep) => (
                  <div
                    key={ep.episode}
                    className={`epChip ${ep.episode === result.episode ? "active" : ""}`}
                    onClick={() => jumpTo(`season ${result.season} episode ${ep.episode}`)}
                  >
                    <div className="n">EP {ep.episode}</div>
                    <div className="t">{ep.title}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="followBar">
              <input
                type="text"
                placeholder={result.mediaType === "tv" ? "next · season 3 · the finale · something like this…" : "something like this · another movie…"}
                onKeyDown={(e) => { if (e.key === "Enter" && e.currentTarget.value.trim()) { const v = e.currentTarget.value; e.currentTarget.value = ""; runQuery(v); } }}
              />
            </div>
            {thread.length > 0 && <div className="followReply">{thread.filter((b) => !b.suggestions && b.role !== "user" && !b.pending).slice(-1)[0]?.text}</div>}
          </div>
        </section>
      )}

      <footer>void · query-driven media · void chromatic system</footer>
    </main>
  );
}
