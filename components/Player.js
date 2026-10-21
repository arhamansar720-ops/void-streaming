"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { SERVERS, embedUrl } from "@/lib/servers";

const PREF_KEY = "void_server";
const LOAD_TIMEOUT_MS = 12000;

// One health request per page session, shared across every result.
let healthPromise = null;
function getHealth() {
  if (!healthPromise) {
    healthPromise = fetch("/api/servers")
      .then((r) => r.json())
      .then((d) => Object.fromEntries(d.servers.map((s) => [s.id, s.up])))
      .catch(() => ({}));
  }
  return healthPromise;
}

function readPref() {
  try { return localStorage.getItem(PREF_KEY); } catch { return null; }
}
function writePref(id) {
  try { localStorage.setItem(PREF_KEY, id); } catch { /* storage blocked */ }
}

// Preferred server first, then healthy ones in registry order, dead ones last.
function orderServers(health, pref) {
  const up = (s) => health[s.id] !== false;
  const healthy = SERVERS.filter(up);
  const dead = SERVERS.filter((s) => !up(s));
  const prefServer = healthy.find((s) => s.id === pref);
  const rest = healthy.filter((s) => s !== prefServer);
  return [...(prefServer ? [prefServer] : []), ...rest, ...dead];
}

export default function Player({ result }) {
  const [health, setHealth] = useState({});
  const [serverId, setServerId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const triedRef = useRef(new Set());
  const loadedRef = useRef(false);

  const resultKey = `${result.mediaType}-${result.tmdbId}-${result.season}-${result.episode}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ordered = useMemo(() => orderServers(health, readPref()), [health, resultKey]);
  const current = SERVERS.find((s) => s.id === serverId) || ordered[0];
  const src = embedUrl(current, result);

  // New title/episode: start over from the best server.
  useEffect(() => {
    triedRef.current = new Set();
    setServerId(null);
    setNotice("");
  }, [resultKey]);

  // Pull health once; if we're sitting on a dead server, hop to the best live one.
  useEffect(() => {
    let alive = true;
    getHealth().then((h) => { if (alive) setHealth(h); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (current && health[current.id] === false) {
      const next = orderServers(health, readPref()).find((s) => health[s.id] !== false);
      if (next && next.id !== current.id) {
        setNotice(`${current.name} is offline — switched to ${next.name}.`);
        setServerId(next.id);
      }
    }
  }, [health, current]);

  // Watchdog: an iframe that never finishes loading usually means a dead host.
  useEffect(() => {
    setLoaded(false);
    loadedRef.current = false;
    triedRef.current.add(current.id);
    const t = setTimeout(() => {
      if (!loadedRef.current) advance(`${current.name} didn't respond`);
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  function advance(reason) {
    const next = ordered.find((s) => !triedRef.current.has(s.id) && health[s.id] !== false);
    if (!next) {
      setNotice(`${reason}. Tried every server — pick one below to retry.`);
      return;
    }
    setNotice(`${reason} — switched to ${next.name}.`);
    setServerId(next.id);
  }

  function pick(id) {
    writePref(id);
    setNotice("");
    setServerId(id);
  }

  function nextServer() {
    const idx = ordered.findIndex((s) => s.id === current.id);
    const next = ordered.slice(idx + 1).concat(ordered.slice(0, idx)).find((s) => health[s.id] !== false);
    if (next) pick(next.id);
  }

  return (
    <>
      <div className="playerCol">
        {!loaded && <div className="playerLoading">Connecting to {current.name}…</div>}
        <iframe
          key={src}
          src={src}
          allowFullScreen
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          referrerPolicy="origin"
          onLoad={() => { loadedRef.current = true; setLoaded(true); }}
        />
      </div>
      <div className="serverBar">
        <div className="serverHead">
          <span className="label">Server</span>
          <button className="pillBtn" onClick={nextServer}>Not playing? Next server →</button>
        </div>
        <div className="serverList">
          {ordered.map((s) => (
            <button
              key={s.id}
              className={`serverChip ${s.id === current.id ? "active" : ""} ${health[s.id] === false ? "down" : ""}`}
              onClick={() => pick(s.id)}
              title={health[s.id] === false ? "Offline right now" : ""}
            >
              <span className="dot" />
              {s.name}
            </button>
          ))}
        </div>
        {notice && <div className="serverNotice">{notice}</div>}
      </div>
    </>
  );
}
