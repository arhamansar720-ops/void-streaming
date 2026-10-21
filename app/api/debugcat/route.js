import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const urls = [
    "https://v3-cinemeta.strem.io/catalog/series/top/search=sevrance.json",
    "https://v3-cinemeta.strem.io/meta/series/tt11280740.json",
    "https://v3-cinemeta.strem.io/meta/movie/tt0816692.json",
  ];
  const out = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      const t = await r.text();
      out.push({ u, status: r.status, len: t.length, head: t.slice(0, 160) });
    } catch (e) { out.push({ u, err: String(e?.cause?.code || e.message) }); }
  }
  return NextResponse.json(out);
}
