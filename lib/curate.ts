import type {
  Certification,
  Kind,
  Movie,
  StreamingService,
} from "./types";

export function filterByKinds(movies: Movie[], kinds: Kind[]): Movie[] {
  if (kinds.length === 0) return movies;
  const set = new Set(kinds);
  return movies.filter((m) => set.has(m.kind));
}

// Weighted score: rating, but boosted by popularity (log of votes).
// Prevents a 9.5 with 30k votes from beating an 8.7 with 2M votes.
export function score(m: Movie): number {
  return m.rating * Math.log10(Math.max(m.votes, 10));
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Picks the top-quality movies, then shuffles within the top tier so each
// page load surfaces a fresh ordering without showing low-quality titles.
// `poolMultiplier` controls how wide the candidate pool is — 2x means we
// shuffle from twice as many movies as we display.
export function topN(
  movies: Movie[],
  n: number,
  withPoster = true,
  poolMultiplier = 2.5,
): Movie[] {
  const list = withPoster ? movies.filter((m) => m.posterPath) : movies;
  const sorted = list.slice().sort((a, b) => score(b) - score(a));
  const poolSize = Math.max(n + 10, Math.ceil(n * poolMultiplier));
  const pool = sorted.slice(0, poolSize);
  return shuffle(pool).slice(0, n);
}

export function byDecade(
  movies: Movie[],
  decadeStart: number,
  n: number,
): Movie[] {
  return topN(
    movies.filter(
      (m) =>
        m.year != null && m.year >= decadeStart && m.year < decadeStart + 10,
    ),
    n,
  );
}

export function byGenre(movies: Movie[], genre: string, n: number): Movie[] {
  return topN(
    movies.filter((m) => m.genres.includes(genre)),
    n,
  );
}

export function decadeLabel(start: number): string {
  if (start === 2020) return "the 2020s";
  if (start === 2010) return "the 2010s";
  if (start === 2000) return "the 2000s";
  return `the ${start - 1900}s`; // 1990 -> 90s, 1980 -> 80s, etc.
}

export function filterByService(
  movies: Movie[],
  service: StreamingService | null,
): Movie[] {
  if (!service) return movies;
  return movies.filter((m) => m.availableOn?.includes(service));
}

export function filterByServices(
  movies: Movie[],
  services: StreamingService[],
): Movie[] {
  if (services.length === 0) return movies;
  const set = new Set(services);
  return movies.filter((m) =>
    (m.availableOn ?? []).some((s) => set.has(s)),
  );
}

export function filterByCertifications(
  movies: Movie[],
  certs: Certification[],
): Movie[] {
  if (certs.length === 0) return movies;
  const set = new Set(certs);
  return movies.filter((m) =>
    m.certification ? set.has(m.certification) : false,
  );
}

// Keep English titles only when `englishOnly` is true. Movies without a
// known original language are treated as English to avoid hiding titles
// that simply have missing TMDB data.
export function filterByEnglishOnly(
  movies: Movie[],
  englishOnly: boolean,
): Movie[] {
  if (!englishOnly) return movies;
  return movies.filter(
    (m) => !m.originalLanguage || m.originalLanguage === "en",
  );
}
