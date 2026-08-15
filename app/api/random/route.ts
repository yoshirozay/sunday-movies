import { readFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  CERTIFICATIONS,
  KINDS,
  REGION_SERVICES,
  type Certification,
  type Kind,
  type Movie,
  type Region,
  type StreamingService,
} from "@/lib/types";
import { getRegion } from "@/lib/region";
import {
  filterByCertifications,
  filterByEnglishOnly,
  filterByKinds,
  filterByServices,
} from "@/lib/curate";
import { applyCollection, parseCollectionSlug } from "@/lib/collections";
import { getStreamingTarget, imdbUrl } from "@/lib/streaming";

function parseMulti<T extends string>(
  raw: string | null,
  valid: readonly T[],
): T[] {
  if (!raw) return [];
  const validSet = new Set<string>(valid);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => validSet.has(s));
}

// Per-region cache so warm invocations don't re-read the JSON.
const cache = new Map<Region, Movie[]>();
async function loadMovies(region: Region): Promise<Movie[]> {
  const cached = cache.get(region);
  if (cached) return cached;
  const file = path.join(process.cwd(), "public", `movies-${region}.json`);
  const raw = await readFile(file, "utf8");
  const data = JSON.parse(raw) as Movie[];
  cache.set(region, data);
  return data;
}

export async function GET(req: Request) {
  const region = await getRegion();
  const { searchParams } = new URL(req.url);
  const kinds: Kind[] = !searchParams.has("kinds")
    ? ["movie"]
    : parseMulti<Kind>(searchParams.get("kinds"), KINDS);
  // Mirror app/page.tsx: an explicit `?services=` wins (so shared/filtered
  // links work), but when it's absent fall back to the saved cookie. Without
  // this, surprise-me ignores a returning visitor's saved filter — and since
  // the modal rewrites the URL to /m/{id} (dropping the query), even an active
  // filter is lost on "Try another". filterByServices([]) means "all services".
  const services = searchParams.has("services")
    ? parseMulti<StreamingService>(
        searchParams.get("services"),
        REGION_SERVICES[region],
      )
    : parseMulti<StreamingService>(
        (await cookies()).get("services")?.value ?? null,
        REGION_SERVICES[region],
      );
  const ratings = parseMulti<Certification>(
    searchParams.get("ratings"),
    CERTIFICATIONS,
  );
  const englishOnly = searchParams.get("lang") !== "all";

  const all = await loadMovies(region);
  const filtered = filterByEnglishOnly(
    filterByCertifications(
      filterByServices(filterByKinds(all, kinds), services),
      ratings,
    ),
    englishOnly,
  );

  if (filtered.length === 0) {
    return NextResponse.json(
      { error: "No titles match these filters." },
      { status: 404 },
    );
  }

  // Optional collection scope (e.g. "1990s", "drama"). When the scoped pool
  // can't satisfy the request — empty, or only the excluded current pick —
  // fall back to the unscoped filtered pool so "Try another" never strands
  // the user on the same title.
  const collectionSlug = searchParams.get("collection");
  const exclude = searchParams.get("exclude");
  const scoped = (() => {
    if (!collectionSlug) return filtered;
    const collection = parseCollectionSlug(collectionSlug);
    if (!collection) return filtered;
    return applyCollection(collection, filtered);
  })();
  const eligible = exclude ? scoped.filter((m) => m.id !== exclude) : scoped;
  const fallback = exclude ? filtered.filter((m) => m.id !== exclude) : filtered;
  const pool = eligible.length > 0 ? eligible : fallback;

  if (pool.length === 0) {
    return NextResponse.json(
      { error: "No titles match these filters." },
      { status: 404 },
    );
  }

  const pick = pool[Math.floor(Math.random() * pool.length)];
  const target = getStreamingTarget(pick, services, region);

  return NextResponse.json({
    movie: {
      id: pick.id,
      kind: pick.kind,
      title: pick.title,
      year: pick.year,
      runtime: pick.runtime,
      genres: pick.genres,
      rating: pick.rating,
      certification: pick.certification ?? null,
      overview: pick.overview ?? null,
      posterPath: pick.posterPath ?? null,
      backdropPath: pick.backdropPath ?? null,
      originalLanguage: pick.originalLanguage ?? null,
    },
    target: target
      ? { service: target.service, url: target.url, label: target.label }
      : { service: null, url: imdbUrl(pick), label: "View on IMDb" },
  });
}
