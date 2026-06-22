"use client";
import { useEffect, useRef, useState } from "react";
import Starfield from "@/components/Starfield";
import RingParticle from "@/components/RingParticle";
import WaveDivider from "@/components/WaveDivider";

const PLACEHOLDER_PHRASES = [
  "dexter season 3 episode 2",
  "breaking bad finale",
  "the office s2 e1",
  "severance",
];

const EXAMPLE_CHIPS = [
  { label: "DEXTER S3E2", q: "Dexter season 3 episode 2" },
  { label: "BREAKING BAD FINALE", q: "breaking bad finale" },
  { label: "THE OFFICE S2E1", q: "the office s2 e1" },
  { label: "SEVERANCE", q: "severance" },
];

function streamUrlFor(result) {
  return result.streamUrl;
}

export default function Page() {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [placeholder, setPlaceholder] = useState("");
  const [thread, setThread] = useState([]); // {text, found, error}
  const [step, setStep] = useState(1);
  const [result, setResult] = useState(null); // current rendered result
  const [recall, setRecall] = useState(null);
  const [watchlistLabel, setWatchlistLabel] = useState("+ Watchlist");

  const contextRef = useRef({ lastResult: null, lastSuggestionSlugs: [] });
  const inputRef = useRef(null);

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
    const raw = localStorage.getItem("void_continue");
    if (raw) setRecall(JSON.parse(raw));
  }, []);

  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function addBubble(text, opts = {}) {
    setThread((prev) => [...prev, { text, ...opts }]);
  }

  async function typeBubble(text, opts = {}) {
    const idx = thread.length;
    setThread((prev) => [...prev, { text: "", ...opts }]);
    for (let i = 1; i <= text.length; i++) {
      await wait(16);
      setThread((prev) => {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], text: text.slice(0, i) };
        return copy;
      });
    }
  }

  async function runQuery(raw) {
    raw = (raw || "").trim();
    if (!raw) return;

    setResult(null);
    setRecall(null);
    addBubble(`Searching "${raw}"…`);
    await wait(360);

    let data;
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: raw, context: contextRef.current }),
      });
      data = await res.json();
    } catch {
      await typeBubble("Couldn't reach the search service — check your connection and try again.", { error: true });
      return;
    }

    if (data.kind === "result") {
      addBubble("Match found.");
      await wait(260);
      addBubble(`Found: ${data.result.showTitle} — Season ${data.result.season} Episode ${data.result.episode}`, { found: true });
      await wait(260);
      renderResult(data.result);
      return;
    }

    if (data.kind === "suggestion" || data.kind === "fallback-suggestion") {
      if (data.kind === "fallback-suggestion") {
        await typeBubble("Couldn't pin that to a title in the library — here's what's available instead.", {});
      }
      contextRef.current.lastSuggestionSlugs = data.slugs;
      await typeBubble(data.text, { found: true });
      return;
    }

    await typeBubble('No clean match — try a show name, e.g. "Dexter season 3 episode 2", or ask "what should I watch?"', { error: true });
  }

  function renderResult(r) {
    contextRef.current.lastResult = { showSlug: r.showSlug, season: r.season, episode: r.episode };
    setResult(r);
    setStep(2);
    localStorage.setItem("void_continue", JSON.stringify({
      slug: r.showSlug, season: r.season, episode: r.episode, title: r.showTitle, episodeTitle: r.episodeTitle,
    }));
  }

  async function jumpToEpisode(targetEpisode) {
    if (!result) return;
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `${result.showTitle} season ${result.season} episode ${targetEpisode}`,
          context: contextRef.current,
        }),
      });
      const data = await res.json();
      if (data.kind === "result") renderResult(data.result);
    } catch {
      /* silent — strip click is a convenience action, main search path still works */
    }
  }

  function resetToConsole() {
    setResult(null);
    setThread([]);
    setQuery("");
    contextRef.current = { lastResult: null, lastSuggestionSlugs: [] };
    setStep(1);
    const raw = localStorage.getItem("void_continue");
    if (raw) setRecall(JSON.parse(raw));
    inputRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveWatchlist() {
    if (!result) return;
    const list = JSON.parse(localStorage.getItem("void_watchlist") || "[]");
    if (!list.includes(result.showSlug)) list.push(result.showSlug);
    localStorage.setItem("void_watchlist", JSON.stringify(list));
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
            <h1 className="heroTitle">Tonights<br />the <em>Night.</em></h1>
            <p className="heroSub">
              No browsing, no rows, no menus — say what you want and the system finds it.
              Ask for a show, an episode, or just say you don&apos;t know what to watch.
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
                <button className="goBtn" onClick={() => runQuery(query)}>Find</button>
              </div>
            </div>

            <div className="examples">
              {EXAMPLE_CHIPS.map((c) => (
                <div key={c.label} className="chip" onClick={() => { setQuery(c.q); runQuery(c.q); }}>
                  {c.label}
                </div>
              ))}
            </div>

            {recall && !result && (
              <div className="recall">
                <div className="label">Continue Watching</div>
                <div
                  className="recallChip"
                  onClick={() => runQuery(`${recall.title} season ${recall.season} episode ${recall.episode}`)}
                >
                  <div className="meta">
                    <b>{recall.title}</b>
                    <span>RESUME · S{recall.season}E{recall.episode} — {recall.episodeTitle}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <RingParticle />

        {thread.length > 0 && (
          <div className="threadView show">
            {thread.map((b, i) => (
              <div key={i} className={`bubble ${b.found ? "found" : ""} ${b.error ? "error" : ""}`}>
                <span className="dot" />
                <span>{b.text}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {result && (
        <section className="view">
          <div className="resultView show">
            <div className="eyebrow" style={{ textAlign: "center", width: "100%" }}>02 — PLAYBACK</div>
            <div className="resultGrid">
              <div className="metaCol">
                <div className="show">{result.showTitle}</div>
                <h2>S{result.season} · E{result.episode} — {result.episodeTitle}</h2>
                <div className="sub">Season {result.season} of {result.totalSeasons} · Episode {result.episode}</div>
                <div className="metaActions">
                  <button className="pillBtn" onClick={resetToConsole}>New Search</button>
                  <button className="pillBtn primary" onClick={saveWatchlist}>{watchlistLabel}</button>
                </div>
                <WaveDivider />
              </div>
              <div className="playerCol">
                <iframe
                  src={streamUrlFor(result)}
                  allowFullScreen
                  sandbox="allow-scripts allow-same-origin allow-presentation"
                />
              </div>
            </div>
            {result.seasonEpisodes?.length > 0 && (
              <div className="epStrip">
                {result.seasonEpisodes.map((ep) => (
                  <div
                    key={ep.episode}
                    className={`epChip ${ep.episode === result.episode ? "active" : ""}`}
                    onClick={() => jumpToEpisode(ep.episode)}
                  >
                    <div className="n">EP {ep.episode}</div>
                    <div className="t">{ep.title}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <footer>void · query-driven media · void chromatic system</footer>
    </main>
  );
}
