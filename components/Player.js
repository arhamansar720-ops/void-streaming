"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SERVERS, embedUrl } from "@/lib/servers";
import ShinyText from "@/components/reactbits/ShinyText";

const PREF_KEY = "void_server";
const FAILS_KEY = "void_server_fails";
const LOAD_TIMEOUT_MS = 12000;
const FAIL_MEMORY_MS = 30 * 60 * 1000; // a server that hung is tried last for 30 min
const SWITCH_PAUSE_MS = 900; // long enough to read "switching…"

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

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}
function recentFails() {
  const now = Date.now();
  return Object.fromEntries(Object.entries(read(FAILS_KEY, {})).filter(([, at]) => now - at < FAIL_MEMORY_MS));
}

// Preferred → healthy → recently hung → reported dead.
function orderServers(health, pref, fails) {
  const tier = (s) => (health[s.id] === false ? 3 : fails[s.id] ? 2 : s.id === pref ? 0 : 1);
  return [...SERVERS].sort((a, b) => tier(a) - tier(b));
}

const STATUS_LABEL = { connecting: "connecting", live: "live", switching: "switching", exhausted: "no response" };

export default function Player({ result }) {
  const [health, setHealth] = useState({});
  const [serverId, setServerId] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [failed, setFailed] = useState([]); // server ids that hung for this title
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const triedRef = useRef(new Set());
  const loadedRef = useRef(false);
  const switchTimer = useRef(0);
  const noticeTimer = useRef(0);

  const resultKey = `${result.mediaType}-${result.tmdbId}-${result.season}-${result.episode}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ordered = useMemo(() => orderServers(health, read(PREF_KEY, null), recentFails()), [health, resultKey]);
  const current = SERVERS.find((s) => s.id === serverId) || ordered[0];
  const src = embedUrl(current, result);
  const position = ordered.findIndex((s) => s.id === current.id) + 1;

  // New title/episode: start over from the best server.
  useEffect(() => {
    triedRef.current = new Set();
    clearTimeout(switchTimer.current);
    setServerId(null);
    setFailed([]);
    setNotice("");
  }, [resultKey]);

  useEffect(() => {
    let alive = true;
    getHealth().then((h) => { if (alive) setHealth(h); });
    return () => { alive = false; };
  }, []);

  // Health came back saying we're on a dead server: hop before the viewer waits out the timer.
  useEffect(() => {
    if (health[current.id] === false) {
      const next = ordered.find((s) => health[s.id] !== false);
      if (next && next.id !== current.id) switchTo(next, `${current.name} is offline`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health]);

  // Watchdog: an iframe that never finishes loading usually means a dead host.
  useEffect(() => {
    setStatus("connecting");
    loadedRef.current = false;
    triedRef.current.add(current.id);
    const t = setTimeout(() => {
      if (loadedRef.current) return;
      write(FAILS_KEY, { ...recentFails(), [current.id]: Date.now() });
      setFailed((f) => [...new Set([...f, current.id])]);
      const next = ordered.find((s) => !triedRef.current.has(s.id) && health[s.id] !== false);
      if (next) switchTo(next, `${current.name} didn't respond`);
      else {
        setStatus("exhausted");
        setNotice("No server answered. Pick one to retry — some are slow on first load.");
        setOpen(true);
      }
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // After an automatic switch, confirm where we landed, then let the notice fade.
  function onLive() {
    loadedRef.current = true;
    setStatus("live");
    setNotice((n) => (n.includes("switching to") ? n.replace(/switching to (.+)$/, "now on $1") : n));
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice((n) => (n.includes("now on") ? "" : n)), 4500);
  }

  function switchTo(next, reason) {
    setStatus("switching");
    setNotice(`${reason} — switching to ${next.name}`);
    clearTimeout(switchTimer.current);
    switchTimer.current = setTimeout(() => setServerId(next.id), SWITCH_PAUSE_MS);
  }

  function pick(id) {
    write(PREF_KEY, id);
    clearTimeout(switchTimer.current);
    setNotice("");
    setOpen(false);
    triedRef.current.delete(id);
    setServerId(id);
  }

  function nextServer() {
    const idx = ordered.findIndex((s) => s.id === current.id);
    const next = [...ordered.slice(idx + 1), ...ordered.slice(0, idx)].find((s) => health[s.id] !== false);
    if (next) pick(next.id);
  }

  const busy = status === "connecting" || status === "switching";
  const expanded = busy || hover || status === "exhausted";

  return (
    <div className="playerFrame">
      <div className="playerCol">
        <iframe
          key={src}
          src={src}
          allowFullScreen
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          referrerPolicy="origin"
          onLoad={onLive}
        />
        <AnimatePresence>
          {status !== "live" && (
            <motion.div
              key="overlay"
              className="playerOverlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, filter: "blur(8px)" }}
              transition={{ duration: 0.45 }}
            >
              <div className={`orbit ${status}`}>
                <span /><span /><span />
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id + status}
                  className="overlayLabel"
                  initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
                  transition={{ duration: 0.3 }}
                >
                  {status === "switching" ? (
                    <ShinyText speed={1.6}>{notice}</ShinyText>
                  ) : status === "exhausted" ? (
                    <span>No server answered — pick one below</span>
                  ) : (
                    <ShinyText speed={2.2}>{`Connecting to ${current.name}`}</ShinyText>
                  )}
                </motion.div>
              </AnimatePresence>
              {status === "connecting" && (
                <div className="overlayProgress"><i key={src} style={{ animationDuration: `${LOAD_TIMEOUT_MS}ms` }} /></div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="playerStrip">
        <motion.button
          layout
          className={`serverPill ${status}`}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() => setOpen((o) => !o)}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          aria-expanded={open}
        >
          <motion.span layout className="pillDot" />
          <motion.span layout className="pillName">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={current.id}
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -14, opacity: 0 }}
                transition={{ duration: 0.25 }}
                style={{ display: "inline-block" }}
              >
                {current.name}
              </motion.span>
            </AnimatePresence>
          </motion.span>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.span
                key="status"
                className="pillStatus"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.25 }}
              >
                {status === "live" ? `server ${position}/${ordered.length}` : STATUS_LABEL[status]}
                {busy && <span className="dots"><i /><i /><i /></span>}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        <div className="stripActions">
          <button className="stripBtn" onClick={() => setOpen((o) => !o)}>
            Servers <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: "inline-block" }}>▾</motion.span>
          </button>
          <button className="stripBtn" onClick={nextServer}>Not playing? Next →</button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="drawer"
            className="serverDrawer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.div
              className="serverList"
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.03 } } }}
            >
              {ordered.map((s) => {
                const down = health[s.id] === false;
                const hung = failed.includes(s.id);
                return (
                  <motion.button
                    key={s.id}
                    variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.96 }}
                    className={`serverChip ${s.id === current.id ? "active" : ""} ${down ? "down" : ""} ${hung ? "hung" : ""}`}
                    onClick={() => pick(s.id)}
                    title={down ? "Offline right now" : hung ? "Didn't respond a moment ago" : ""}
                  >
                    <span className="dot" />
                    {s.name}
                    {hung && <span className="chipTag">timed out</span>}
                  </motion.button>
                );
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {notice && status !== "switching" && (
          <motion.div
            key={notice}
            className="serverNotice"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
