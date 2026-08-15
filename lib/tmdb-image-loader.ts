// Bypass Vercel's image optimizer — TMDB already serves discrete size variants.
// Applied per-instance via the `loader` prop so the hero can opt out and use
// Vercel's optimizer (AVIF/WebP) for max-quality first-impression rendering.

const POSTER_SIZES = [185, 342, 500, 780] as const;
const BACKDROP_SIZES = [300, 780, 1280] as const;
const TMDB_SIZE_RE = /\/t\/p\/w(\d+)\//;

export function tmdbImageLoader({
  src,
  width,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  const match = src.match(TMDB_SIZE_RE);
  if (!match) return src;
  // w780 is valid for both posters and backdrops; treat >500 as backdrop
  // since posters cap at w780 either way.
  const candidates = Number(match[1]) > 500 ? BACKDROP_SIZES : POSTER_SIZES;
  const variant =
    candidates.find((v) => v >= width) ?? candidates[candidates.length - 1];
  return src.replace(TMDB_SIZE_RE, `/t/p/w${variant}/`);
}
