import type { Movie } from "./types";
import { score } from "./curate";

export type Collection =
  | { kind: "all" }
  | { kind: "decade"; start: number }
  | { kind: "genre"; name: string };

// Slugs we expose in /c/[slug] URLs. Keep stable — these are shareable.
export const ALL_SLUG = "all-time-best";

const GENRE_BY_SLUG: Record<string, string> = {
  drama: "Drama",
  "sci-fi": "Sci-Fi",
  thriller: "Thriller",
  comedy: "Comedy",
  action: "Action",
  crime: "Crime",
  animation: "Animation",
  horror: "Horror",
  mystery: "Mystery",
  adventure: "Adventure",
  romance: "Romance",
  history: "History",
};
const SLUG_BY_GENRE: Record<string, string> = Object.fromEntries(
  Object.entries(GENRE_BY_SLUG).map(([slug, name]) => [name, slug]),
);

export function decadeSlug(start: number): string {
  return `${start}s`;
}

export function genreSlug(name: string): string {
  return SLUG_BY_GENRE[name] ?? name.toLowerCase();
}

export function parseCollectionSlug(slug: string): Collection | null {
  if (slug === ALL_SLUG) return { kind: "all" };
  const m = slug.match(/^(\d{4})s$/);
  if (m) {
    const start = parseInt(m[1], 10);
    if (start >= 1900 && start <= 2030) return { kind: "decade", start };
  }
  const genre = GENRE_BY_SLUG[slug.toLowerCase()];
  if (genre) return { kind: "genre", name: genre };
  return null;
}

export function collectionTitle(c: Collection): string {
  if (c.kind === "all") return "The all-time best";
  if (c.kind === "decade") {
    if (c.start === 2020) return "Best of the 2020s";
    if (c.start === 2010) return "Best of the 2010s";
    if (c.start === 2000) return "Best of the 2000s";
    return `Best of the ${c.start - 1900}s`;
  }
  return `Best ${c.name.toLowerCase()}`;
}

// Returns ALL items in the collection sorted by score (no shuffling — the
// /c page is meant to be exhaustive, not surprising).
export function applyCollection(c: Collection, movies: Movie[]): Movie[] {
  let pool: Movie[];
  if (c.kind === "all") pool = movies.slice();
  else if (c.kind === "decade")
    pool = movies.filter(
      (m) =>
        m.year != null && m.year >= c.start && m.year < c.start + 10,
    );
  else pool = movies.filter((m) => m.genres.includes(c.name));
  return pool.filter((m) => m.posterPath).sort((a, b) => score(b) - score(a));
}

// Count without enumerating — used to decide whether to show "view all" tile.
export function collectionCount(c: Collection, movies: Movie[]): number {
  return applyCollection(c, movies).length;
}
