import { NextResponse } from "next/server";
import { SERVERS, embedUrl } from "@/lib/servers";

// Probes every embed provider in parallel so the player can skip dead ones
// (expired domain, broken DNS, 404 for this title, 5xx) before the viewer waits on a blank iframe.
//   GET /api/servers                          → generic health (probes a known movie)
//   GET /api/servers?type=tv&id=1396&s=1&e=1  → health for that exact title/episode
const PROBE_TIMEOUT_MS = 4500;
const CACHE_MS = 10 * 60 * 1000;
const NOT_FOUND = /<title>[^<]*(404|not found|unavailable|error)[^<]*<\/title>/i;

const cache = new Map(); // key -> { at, body }

async function probe(server, target) {
  const started = Date.now();
  try {
    const res = await fetch(embedUrl(server, target), {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    // 403/429 are usually Cloudflare bot walls that a real browser passes; 404 and 5xx mean the embed is broken.
    let up = res.status < 400 || res.status === 403 || res.status === 429;
    if (up && res.status < 300) {
      const head = (await res.text()).slice(0, 4000);
      if (NOT_FOUND.test(head)) up = false;
    }
    return { id: server.id, up, ms: Date.now() - started };
  } catch (err) {
    // Some hosts ship an incomplete cert chain: browsers repair it, Node refuses. Still reachable.
    const code = err?.cause?.code || "";
    return { id: server.id, up: /CERT|ISSUER|SELF_SIGNED/.test(code), ms: Date.now() - started };
  }
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const id = Number(q.get("id"));
  const target = id
    ? q.get("type") === "tv"
      ? { mediaType: "tv", tmdbId: id, season: Number(q.get("s")) || 1, episode: Number(q.get("e")) || 1 }
      : { mediaType: "movie", tmdbId: id }
    : { mediaType: "movie", tmdbId: 550 }; // Fight Club — exists on every provider
  const key = JSON.stringify(target);

  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) {
    const results = await Promise.all(SERVERS.map((s) => probe(s, target)));
    hit = { at: Date.now(), body: { checkedAt: new Date().toISOString(), servers: results } };
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    cache.set(key, hit);
  }
  return NextResponse.json(hit.body, {
    headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" },
  });
}
