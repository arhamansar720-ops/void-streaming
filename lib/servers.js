// Embed providers, in default priority order. Every provider takes a TMDB id.
// Shared by the client (to build iframe URLs) and /api/servers (health checks).
// If one goes dark, the player skips it automatically — add/remove entries here.
export const SERVERS = [
  {
    id: "vidlink",
    name: "VidLink",
    movie: (id) => `https://vidlink.pro/movie/${id}`,
    tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}`,
  },
  {
    id: "videasy",
    name: "Videasy",
    movie: (id) => `https://player.videasy.net/movie/${id}`,
    tv: (id, s, e) => `https://player.videasy.net/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidsrcto",
    name: "VidSrc.to",
    movie: (id) => `https://vidsrc.to/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidsrcme",
    name: "VidSrc.me",
    movie: (id) => `https://vidsrc.me/embed/movie?tmdb=${id}`,
    tv: (id, s, e) => `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
  },
  {
    id: "vidfast",
    name: "VidFast",
    movie: (id) => `https://vidfast.pro/movie/${id}`,
    tv: (id, s, e) => `https://vidfast.pro/tv/${id}/${s}/${e}`,
  },
  {
    id: "2embed",
    name: "2Embed",
    movie: (id) => `https://www.2embed.cc/embed/${id}`,
    tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`,
  },
  {
    id: "autoembed",
    name: "AutoEmbed",
    movie: (id) => `https://autoembed.co/movie/tmdb/${id}`,
    tv: (id, s, e) => `https://autoembed.co/tv/tmdb/${id}-${s}-${e}`,
  },
  {
    id: "autoembedto",
    name: "AutoEmbed.to",
    movie: (id) => `https://autoembed.to/movie/tmdb/${id}`,
    tv: (id, s, e) => `https://autoembed.to/tv/tmdb/${id}-${s}-${e}`,
  },
  {
    id: "vidsrcsu",
    name: "VidSrc SU",
    movie: (id) => `https://vidsrc.su/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidsrc.su/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidzee",
    name: "VidZee",
    movie: (id) => `https://player.vidzee.wtf/embed/movie/${id}`,
    tv: (id, s, e) => `https://player.vidzee.wtf/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "primesrc",
    name: "PrimeSrc",
    movie: (id) => `https://primesrc.me/embed/movie?tmdb=${id}`,
    tv: (id, s, e) => `https://primesrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
  },
];

export function embedUrl(server, r) {
  return r.mediaType === "movie"
    ? server.movie(r.tmdbId)
    : server.tv(r.tmdbId, r.season, r.episode);
}
