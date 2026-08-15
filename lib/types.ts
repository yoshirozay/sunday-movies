export type StreamingService =
  | "netflix"
  | "prime"
  | "hulu"
  | "hbo"
  | "paramount"
  | "disney"
  | "crave"
  | "peacock"
  | "now"
  | "stan"
  | "hbomax"
  | "apple";

export type Region = "ca" | "us" | "gb" | "au";

export const REGIONS: Region[] = ["ca", "us", "gb", "au"];

// Per-region service list — drives the filter sidebar's display order. Only
// services in a region's list are rendered as filter options when that
// region is active. CA uses the existing 5; US uses 8.
//
// Peacock stays enabled. Investigated 2026-06-10 (scripts/
// probe-peacock-sample.mjs, the Hulu methodology): valid and dead asset
// URLs return byte-identical 200 SPA shells — no status, redirect, or
// og-tag signal exists server-side, so the SPA-blind verdict is confirmed
// (unlike Hulu). Rot exposure is no worse than Netflix/Prime/Disney, and
// the reconcile + availability-snapshot machinery bounds staleness.
export const REGION_SERVICES: Record<Region, StreamingService[]> = {
  ca: ["netflix", "prime", "disney", "crave", "apple"],
  us: ["netflix", "prime", "hulu", "hbo", "paramount", "disney", "peacock", "apple"],
  gb: ["netflix", "prime", "disney", "paramount", "now", "apple"],
  au: ["netflix", "prime", "disney", "paramount", "stan", "hbomax", "apple"],
};

// MPAA-style US certifications we filter on. TV ratings are mapped into this
// same scale so the filter UI works for both: TV-Y/TV-G→G, TV-PG→PG,
// TV-14→PG-13, TV-MA→R.
export type Certification = "G" | "PG" | "PG-13" | "R" | "NC-17" | "NR";

export type Kind = "movie" | "tv";

export const KINDS: Kind[] = ["movie", "tv"];

export const KIND_LABEL: Record<Kind, string> = {
  movie: "Movies",
  tv: "TV shows",
};

// Named "Movie" for historical reasons but covers both movies and TV shows.
// Distinguished by the `kind` field.
export type Movie = {
  id: string;
  kind: Kind;
  title: string;
  year: number | null;
  runtime: number | null;
  genres: string[];
  rating: number;
  votes: number;
  tmdbId?: number | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  overview?: string | null;
  availableOn?: StreamingService[];
  certification?: Certification;
  // ISO 639-1 code (e.g. "en", "es", "ko"). Used to surface non-English
  // titles. English titles render no language label.
  originalLanguage?: string | null;
  // Direct deep-link URLs per service (resolved at build time). When missing
  // for a given service, the UI falls back to a search URL.
  streamingLinks?: Partial<Record<StreamingService, string>>;
};

export const STREAMING_SERVICES: StreamingService[] = [
  "netflix",
  "prime",
  "disney",
  "crave",
  "apple",
];

export const CERTIFICATIONS: Certification[] = [
  "G",
  "PG",
  "PG-13",
  "R",
  "NC-17",
  "NR",
];

export const SERVICE_LABEL: Record<StreamingService, string> = {
  netflix: "Netflix",
  prime: "Prime Video",
  hulu: "Hulu",
  hbo: "Max",
  paramount: "Paramount+",
  disney: "Disney+",
  crave: "Crave",
  peacock: "Peacock",
  now: "Now",
  stan: "Stan",
  hbomax: "HBO Max",
  apple: "Apple TV+",
};

export const SERVICE_LOGO: Record<StreamingService, string> = {
  netflix: "/logos/netflix.svg",
  prime: "/logos/prime-video.svg",
  hulu: "/logos/hulu.svg",
  hbo: "/logos/max.svg",
  paramount: "/logos/paramount-plus.svg",
  disney: "/logos/disney-plus.svg",
  crave: "/logos/crave.svg",
  peacock: "/logos/peacock.svg",
  now: "/logos/now.svg",
  stan: "/logos/stan.svg",
  hbomax: "/logos/max.svg",
  apple: "/logos/apple-tv.svg",
};

// Common cinema/TV language codes mapped to display names. Anything not in
// this map falls back to the uppercased ISO code (e.g. unknown "xx" → "XX").
const LANGUAGE_LABEL: Record<string, string> = {
  ko: "Korean",
  ja: "Japanese",
  zh: "Chinese",
  cn: "Chinese",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  de: "German",
  pt: "Portuguese",
  hi: "Hindi",
  ru: "Russian",
  sv: "Swedish",
  no: "Norwegian",
  nb: "Norwegian",
  da: "Danish",
  nl: "Dutch",
  ar: "Arabic",
  tr: "Turkish",
  pl: "Polish",
  fa: "Persian",
  he: "Hebrew",
  el: "Greek",
  cs: "Czech",
  hu: "Hungarian",
  ro: "Romanian",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  ml: "Malayalam",
  ta: "Tamil",
  te: "Telugu",
  bn: "Bengali",
  ka: "Georgian",
  is: "Icelandic",
  fi: "Finnish",
  uk: "Ukrainian",
  ms: "Malay",
  af: "Afrikaans",
  sw: "Swahili",
  bg: "Bulgarian",
  hr: "Croatian",
  sr: "Serbian",
  sk: "Slovak",
  sl: "Slovenian",
};

/**
 * Returns the display language label for a TMDB ISO code, or `null` for
 * English / missing — caller treats `null` as "don't render".
 */
export function languageLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = code.toLowerCase();
  if (normalized === "en") return null;
  return LANGUAGE_LABEL[normalized] ?? normalized.toUpperCase();
}

// Image CDN base URL. When NEXT_PUBLIC_IMAGE_CDN is set we serve posters and
// backdrops from our Vercel Blob mirror; otherwise fall back to TMDB's CDN.
// The blob mirror replicates TMDB's `/{size}/{path}` URL structure exactly,
// so this is a pure prefix swap — no per-title URL changes anywhere else.
export const TMDB_IMG =
  process.env.NEXT_PUBLIC_IMAGE_CDN ?? "https://image.tmdb.org/t/p";

export function posterUrl(
  path: string | null | undefined,
  size: "w185" | "w342" | "w500" | "w780" | "original" = "w342",
): string | null {
  return path ? `${TMDB_IMG}/${size}${path}` : null;
}

export function backdropUrl(
  path: string | null | undefined,
  size: "w780" | "w1280" | "original" = "w1280",
): string | null {
  return path ? `${TMDB_IMG}/${size}${path}` : null;
}
