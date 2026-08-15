import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MetadataRoute } from "next";
import { REGIONS, type Movie, type Region } from "@/lib/types";
import { ALL_SLUG, decadeSlug, genreSlug } from "@/lib/collections";

const BASE = "https://sundaymovies.io";

// Genre + decade lists must match what app/page.tsx renders rails for —
// otherwise we'd ship sitemap entries for collection pages that exist but
// have no internal link, or omit pages users can reach.
const DECADES = [2020, 2010, 2000, 1990, 1980, 1970];
const GENRES = [
  "Drama",
  "Comedy",
  "Action",
  "Mystery",
  "Thriller",
  "Crime",
  "Horror",
  "Romance",
  "Sci-Fi",
  "Animation",
  "Adventure",
  "History",
];

async function loadCatalog(region: Region): Promise<Movie[]> {
  const file = path.join(process.cwd(), "public", `movies-${region}.json`);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as Movie[];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Dedupe titles across regions — a movie on both CA and US gets one
  // canonical URL (region is resolved at request time inside the page).
  const seen = new Map<string, Movie>();
  for (const r of REGIONS) {
    const list = await loadCatalog(r);
    for (const m of list) {
      if (!seen.has(m.id)) seen.set(m.id, m);
    }
  }
  const titles = Array.from(seen.values());

  const titleEntries: MetadataRoute.Sitemap = titles.map((m) => ({
    url: `${BASE}/${m.kind === "tv" ? "t" : "m"}/${m.id}`,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const collectionEntries: MetadataRoute.Sitemap = [
    ALL_SLUG,
    ...DECADES.map((d) => decadeSlug(d)),
    ...GENRES.map((g) => genreSlug(g)),
  ].map((slug) => ({
    url: `${BASE}/c/${slug}`,
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  return [
    {
      url: `${BASE}/`,
      changeFrequency: "daily" as const,
      priority: 1.0,
    },
    ...collectionEntries,
    ...titleEntries,
  ];
}
