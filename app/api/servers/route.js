import { NextResponse } from "next/server";
import { SERVERS } from "@/lib/servers";

// Probes every embed provider so the player can skip dead ones (expired domain,
// broken DNS, 5xx) before the viewer ever sees a blank iframe.
const PROBE_TMDB_ID = 550; // Fight Club — exists on every provider
const PROBE_TIMEOUT_MS = 4500;
const CACHE_MS = 10 * 60 * 1000;

let cache = null; // { at, body }

async function probe(server) {
  const started = Date.now();
  try {
    const res = await fetch(server.movie(PROBE_TMDB_ID), {
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
    const up = res.status < 400 || res.status === 403 || res.status === 429;
    return { id: server.id, up, ms: Date.now() - started };
  } catch (err) {
    // Some hosts ship an incomplete cert chain: browsers repair it, Node refuses. Still reachable.
    const code = err?.cause?.code || "";
    const up = /CERT|ISSUER|SELF_SIGNED/.test(code);
    return { id: server.id, up, ms: Date.now() - started };
  }
}

export async function GET() {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const results = await Promise.all(SERVERS.map(probe));
    cache = { at: Date.now(), body: { checkedAt: new Date().toISOString(), servers: results } };
  }
  return NextResponse.json(cache.body, {
    headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" },
  });
}
