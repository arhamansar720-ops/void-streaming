import { NextResponse } from "next/server";
import { getLibrary } from "@/lib/library";
import { resolveQuery, isSuggestionQuery, buildSuggestionReply, tryFollowup } from "@/lib/queryEngine";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad-request" }, { status: 400 });
  }

  const { query, context } = body || {};
  if (!query || typeof query !== "string") {
    return NextResponse.json({ ok: false, reason: "missing-query" }, { status: 400 });
  }

  const library = await getLibrary();

  // 1. follow-up context (next episode, season jump, "something else", etc.)
  const followup = tryFollowup(library, query, context);
  if (followup) {
    if (followup.type === "result" && followup.result) {
      return NextResponse.json({ kind: "result", result: followup.result });
    }
    if (followup.type === "suggestion") {
      const { text, slugs } = buildSuggestionReply(library, context?.lastSuggestionSlugs || []);
      return NextResponse.json({ kind: "suggestion", text, slugs });
    }
  }

  // 2. open-ended "what should I watch" style questions
  if (isSuggestionQuery(query)) {
    const { text, slugs } = buildSuggestionReply(library, context?.lastSuggestionSlugs || []);
    return NextResponse.json({ kind: "suggestion", text, slugs });
  }

  // 3. direct show/episode resolution
  const result = resolveQuery(library, query);
  if (result.ok) {
    return NextResponse.json({ kind: "result", result });
  }

  // 4. no match at all — fall back to suggestions if there's no episode info,
  //    otherwise a plain no-match response
  const hasEpisodeMarkers = /s\d{1,2}\s*e\d{1,3}|\d{1,2}x\d{1,3}|season\s*\d|episode\s*\d|finale|pilot/i.test(query);
  if (!hasEpisodeMarkers) {
    const { text, slugs } = buildSuggestionReply(library, context?.lastSuggestionSlugs || []);
    return NextResponse.json({ kind: "fallback-suggestion", text, slugs });
  }

  return NextResponse.json({ kind: "no-match" });
}
