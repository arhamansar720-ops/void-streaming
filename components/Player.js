"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { SERVERS, embedUrl } from "@/lib/servers";
import ShinyText from "@/components/reactbits/ShinyText";

// Flow: scan (blur + sweep through every server while /api/servers checks this exact title)
//    → connect (winner expanded, iframe loading under the blur)
//    → live (blur lifts, the server pills glide down under the player)
// A hang during connect re-veils the player and sweeps on to the next server.

const PREF_KEY = "void_server";
const FAILS_KEY = "void_server_fails";
const LOAD_TIMEOUT_MS = 12000;
const FAIL_MEMORY_MS = 30 * 60 * 1000; // a server that hung is tried last for 30 min
const SCAN_STEP_MS = 380;
const SWITCH_STEP_MS = 280;
const PROBE_WAIT_MS = 5000;
const MIN_CONNECT_MS = 2000; // let the winning pill sit expanded before the blur lifts

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Preferred first, recently hung last. Fixed for the whole run so pills never jump around mid-sweep.
function orderServers() {
  const pref = read(PREF_KEY, null);
  const fails = recentFails();
  const tier = (s) => (fails[s.id] ? 2 : s.id === pref ? 0 : 1);
  return [...SERVERS].sort((a, b) => tier(a) - tier(b));
}

function probeUrl(r) {
  return r.mediaType === "tv"
    ? `/api/servers?type=tv&id=${r.tmdbId}&s=${r.season}&e=${r.episode}`
    : `/api/servers?type=movie&id=${r.tmdbId}`;
}

const LABEL = { checking: "checking", connecting: "connecting", active: "live" };

export default function Player({ result, onLive }) {
  const [order, setOrder] = useState(() => SERVERS);
  const [phase, setPhase] = useState("scan"); // scan | connect | live | switching | exhausted
  const [scanId, setScanId] = useState(null); // pill currently being swept over
  const [verdict, setVerdict] = useState({}); // id -> true (reachable) | false (down for this title)
  const [hung, setHung] = useState([]); // ids that timed out during this title
  const [serverId, setServerId] = useState(null);
  const [notice, setNotice] = useState("");
  const [runKey, setRunKey] = useState(null); // which result the current state belongs to
  const runRef = useRef(0);
  const loadedRef = useRef(false);
  const connectAt = useRef(0);

  const resultKey = `${result.mediaType}-${result.tmdbId}-${result.season}-${result.episode}`;
  // Until the scan effect has reset state for a new title, render as "scanning" — otherwise
  // the old live player would briefly reload the new episode unblurred.
  const stale = runKey !== resultKey;
  const view = stale ? "scan" : phase;
  const current = stale ? null : SERVERS.find((s) => s.id === serverId) || null;
  const src = current ? embedUrl(current, result) : null;
  const veiled = view !== "live";

  // ---------- scan: sweep every pill while the title-specific probe runs ----------
  useEffect(() => {
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    const ord = orderServers();
    setOrder(ord);
    setPhase("scan");
    setVerdict({});
    setHung([]);
    setServerId(null);
    setNotice("");
    setScanId(null);
    setRunKey(resultKey);

    let probe = null;
    const probing = fetch(probeUrl(result))
      .then((r) => r.json())
      .then((d) => { probe = Object.fromEntries(d.servers.map((s) => [s.id, s.up])); })
      .catch(() => { probe = {}; });

    (async () => {
      for (const s of ord) {
        if (!alive()) return;
        setScanId(s.id);
        await wait(SCAN_STEP_MS);
        if (probe) setVerdict((v) => ({ ...v, [s.id]: probe[s.id] !== false }));
      }
      await Promise.race([probing, wait(PROBE_WAIT_MS)]);
      if (!alive()) return;
      const final = Object.fromEntries(ord.map((s) => [s.id, probe ? probe[s.id] !== false : true]));
      setVerdict(final);
      setScanId(null);
      const winner = ord.find((s) => final[s.id]) || ord[0];
      setServerId(winner.id);
      setPhase("connect");
    })();

    return () => { runRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey]);

  // ---------- connect: watchdog on the iframe ----------
  useEffect(() => {
    if (phase !== "connect" || !src) return;
    loadedRef.current = false;
    connectAt.current = Date.now();
    const run = runRef.current;
    const t = setTimeout(() => {
      if (loadedRef.current || runRef.current !== run) return;
      write(FAILS_KEY, { ...recentFails(), [current.id]: Date.now() });
      setHung((h) => [...new Set([...h, current.id])]);
      sweepToNext(current.id, `${current.name} didn't respond`);
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, src]);

  async function sweepToNext(fromId, reason) {
    const run = ++runRef.current;
    const skip = new Set([...hung, fromId]);
    const idx = order.findIndex((s) => s.id === fromId);
    const rest = [...order.slice(idx + 1), ...order.slice(0, idx)];
    const next = rest.find((s) => verdict[s.id] !== false && !skip.has(s.id));
    setPhase("switching");
    setNotice(next ? `${reason} — trying ${next.name}` : reason);
    for (const s of rest) {
      if (runRef.current !== run) return;
      setScanId(s.id);
      await wait(SWITCH_STEP_MS);
      if (s === next) break;
    }
    if (runRef.current !== run) return;
    setScanId(null);
    if (!next) {
      setPhase("exhausted");
      setNotice("No server answered — tap one to retry. Some are slow on first load.");
      return;
    }
    setServerId(next.id);
    setPhase("connect");
  }

  function handleLoad() {
    if (phase !== "connect" || loadedRef.current) return;
    loadedRef.current = true;
    const run = runRef.current;
    const id = current.id;
    setTimeout(() => {
      if (runRef.current !== run) return;
      setPhase("live");
      setNotice((n) => (n.includes("trying") ? n.replace(/trying (.+)$/, "now on $1") : ""));
      onLive?.(id);
    }, Math.max(0, MIN_CONNECT_MS - (Date.now() - connectAt.current)));
  }

  function pick(id) {
    if (phase === "scan" || phase === "switching") return;
    if (id === serverId && phase === "live") return;
    runRef.current++;
    write(PREF_KEY, id);
    setHung((h) => h.filter((x) => x !== id));
    setNotice("");
    setServerId(id);
    setPhase("connect");
  }

  function nextServer() {
    if (!current) return;
    const idx = order.findIndex((s) => s.id === current.id);
    const next = [...order.slice(idx + 1), ...order.slice(0, idx)].find((s) => verdict[s.id] !== false && !hung.includes(s.id));
    if (next) pick(next.id);
  }

  function pillState(s) {
    if (s.id === scanId) return "checking";
    if (stale) return "idle";
    if (s.id === serverId && (phase === "connect" || phase === "live")) return phase === "live" ? "active" : "connecting";
    if (hung.includes(s.id) || verdict[s.id] === false) return "down";
    if (verdict[s.id] === true) return "ok";
    return "idle";
  }

  // Rendered in exactly one slot at a time (over the stage while veiled, in the strip once live);
  // the shared layoutIds make every pill glide between the two.
  const rack = (
    <motion.div layout className={`pillRack ${veiled ? "centered" : "docked"}`} transition={{ type: "spring", stiffness: 90, damping: 20 }}>
      {order.map((s) => {
        const st = pillState(s);
        const expanded = st === "checking" || st === "connecting" || st === "active";
        return (
          <motion.button
            key={s.id}
            layout
            layoutId={`srv-${s.id}`}
            className={`spill ${st}`}
            onClick={() => pick(s.id)}
            transition={{ type: "spring", stiffness: 110, damping: 18 }}
            whileHover={view === "live" ? { y: -2 } : undefined}
            whileTap={{ scale: 0.95 }}
            title={st === "down" ? "Not available for this title right now" : s.name}
          >
            <motion.span layout className="spillDot" />
            <motion.span layout className="spillName">{s.name}</motion.span>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.span
                  key="lbl"
                  className="spillLabel"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  {LABEL[st]}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </motion.div>
  );

  const headline =
    view === "scan" ? "Finding the best server"
    : phase === "connect" ? `Connecting to ${current?.name}`
    : phase === "switching" ? notice
    : phase === "exhausted" ? "No server answered"
    : "";

  return (
    <LayoutGroup id="servers">
      <div className="playerFrame">
        <div className="playerStage">
          {result.backdrop && <img className={`stageArt ${veiled ? "on" : ""}`} src={result.backdrop} alt="" />}
          {src && (
            <iframe
              key={src}
              src={src}
              className={veiled ? "veiled" : ""}
              allowFullScreen
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              referrerPolicy="origin"
              onLoad={handleLoad}
            />
          )}
          <AnimatePresence>
            {veiled && (
              <motion.div
                key="veil"
                className="veil"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.1, ease: "easeInOut" }}
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={headline}
                    className="veilTitle"
                    initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
                    transition={{ duration: 0.5 }}
                  >
                    {view === "exhausted" ? headline : <ShinyText speed={2}>{headline}</ShinyText>}
                  </motion.div>
                </AnimatePresence>
                {view === "connect" && (
                  <div className="veilProgress"><i key={src} style={{ animationDuration: `${LOAD_TIMEOUT_MS}ms` }} /></div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {veiled && <div className="rackSlot">{rack}</div>}
        </div>

        <div className="playerStrip">
          {!veiled ? rack : <div className="stripHint">{view === "exhausted" ? "Pick a server above" : "Testing servers…"}</div>}
          <button className="stripBtn" onClick={nextServer} disabled={veiled && view !== "exhausted"}>
            Next server →
          </button>
        </div>

        <AnimatePresence>
          {notice && view === "live" && (
            <motion.div key={notice} className="serverNotice" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {notice}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}
