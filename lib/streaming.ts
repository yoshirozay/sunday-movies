import {
  SERVICE_LABEL,
  type Movie,
  type Region,
  type StreamingService,
} from "./types";

// Services whose search URL lives on a different host (or path) per region.
// Amazon and Paramount+ use country-code TLDs — the wrong TLD lands on the
// wrong catalog or 404s outright (paramountplus.com is US-only; GB/AU live
// on .co.uk/.com.au). Apple TV+ scopes search under a storefront path.
const AMAZON_HOST: Record<Region, string> = {
  ca: "www.amazon.ca",
  us: "www.amazon.com",
  gb: "www.amazon.co.uk",
  au: "www.amazon.com.au",
};
const PARAMOUNT_HOST: Record<Region, string> = {
  ca: "www.paramountplus.com",
  us: "www.paramountplus.com",
  gb: "www.paramountplus.co.uk",
  au: "www.paramountplus.com.au",
};

// Each service's search URL — landing the user on a pre-filled search results
// page for the movie title. We can't deep-link to specific titles without
// per-service content IDs (which TMDB doesn't provide), so search is the next
// best thing: one click on the service to open the right movie, using the
// user's existing logged-in session. Single-region services (hulu, crave,
// peacock, now, stan, hbomax) ignore the region; netflix/disney geo-route on
// their own.
const SEARCH_URL: Record<
  StreamingService,
  (query: string, region: Region) => string
> = {
  netflix: (q) => `https://www.netflix.com/search?q=${encodeURIComponent(q)}`,
  prime: (q, r) =>
    `https://${AMAZON_HOST[r]}/s?k=${encodeURIComponent(q)}&i=instant-video`,
  hulu: (q) => `https://www.hulu.com/search?q=${encodeURIComponent(q)}`,
  // HBO Max has no server-routable search URL — every /search variant
  // (max.com and hbomax.com, with/without locale prefix) returns a hard
  // "Oops!" 404 (verified 2026-06-10). The regional root is the only
  // never-404 landing; search there is client-side only.
  hbo: () => `https://www.hbomax.com/`,
  paramount: (q, r) =>
    `https://${PARAMOUNT_HOST[r]}/search/?q=${encodeURIComponent(q)}`,
  // /search?q= 404s; /browse/search is the web app's real search route
  // (verified 2026-06-10).
  disney: (q) =>
    `https://www.disneyplus.com/browse/search?q=${encodeURIComponent(q)}`,
  // /en/search?q= redirects to the homepage and drops the query; the
  // un-prefixed /search?q= keeps both (verified 2026-06-10).
  crave: (q) => `https://www.crave.ca/search?q=${encodeURIComponent(q)}`,
  // /search?q= 404s; the app lives under /watch (verified 2026-06-10).
  peacock: (q) =>
    `https://www.peacocktv.com/watch/search?q=${encodeURIComponent(q)}`,
  now: (q) => `https://www.nowtv.com/search?q=${encodeURIComponent(q)}`,
  stan: (q) => `https://play.stan.com.au/search?q=${encodeURIComponent(q)}`,
  // Same no-search-route situation as US HBO Max (verified 2026-06-10).
  hbomax: () => `https://www.hbomax.com/au/en`,
  apple: (q, r) =>
    `https://tv.apple.com/${r}/search?term=${encodeURIComponent(q)}`,
};

// Region-aware search-results URL for a service — the fallback when a title
// has no resolved deep link.
export function serviceSearchUrl(
  service: StreamingService,
  query: string,
  region: Region,
): string {
  return SEARCH_URL[service](query, region);
}

export function pickService(
  movie: Movie,
  preferred: StreamingService[] = [],
): StreamingService | null {
  const available = movie.availableOn ?? [];
  if (available.length === 0) return null;
  for (const p of preferred) {
    if (available.includes(p)) return p;
  }
  return available[0]; // availableOn is already sorted in our priority order
}

export type StreamingTarget = {
  service: StreamingService;
  url: string;
  label: string; // e.g. "Watch on Netflix"
};

export function getStreamingTarget(
  movie: Movie,
  preferred: StreamingService[] = [],
  region: Region = "ca",
): StreamingTarget | null {
  const service = pickService(movie, preferred);
  if (!service) return null;
  // Prefer a build-time-resolved deep link; fall back to a search URL.
  return {
    service,
    url:
      movie.streamingLinks?.[service] ??
      serviceSearchUrl(service, movie.title, region),
    label: `Watch on ${SERVICE_LABEL[service]}`,
  };
}

// IMDb fallback URL (used when there's no streaming option, or for "info" links)
export function imdbUrl(movie: Movie): string {
  return `https://www.imdb.com/title/${movie.id}/`;
}
