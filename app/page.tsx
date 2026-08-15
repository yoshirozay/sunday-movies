import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import {
  CERTIFICATIONS,
  KINDS,
  REGION_SERVICES,
  SERVICE_LABEL,
  type Certification,
  type Kind,
  type Movie,
  type Region,
  type StreamingService,
} from "@/lib/types";
import { getRegion } from "@/lib/region";
import { cookies } from "next/headers";
import {
  byDecade,
  byGenre,
  decadeLabel,
  filterByCertifications,
  filterByEnglishOnly,
  filterByKinds,
  filterByServices,
  topN,
} from "@/lib/curate";
import {
  collectionCount,
  decadeSlug,
  genreSlug,
} from "@/lib/collections";
import { Suspense } from "react";
import { CoffeeButton } from "./_components/coffee-button";
import { FiltersDrawer } from "./_components/filters-drawer";
import { Hero } from "./_components/hero";
import { OnboardingModal } from "./_components/onboarding-modal";
import { RandomButton } from "./_components/random-button";
import { Rail } from "./_components/rail";
import { SearchButton } from "./_components/search-button";

// Reading cookies/headers in getRegion() opts this route into dynamic
// rendering, so static caching no longer applies. We can revisit caching
// strategy (URL-based regions, middleware rewrites, PPR) post-launch.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const region = await getRegion();
  const services = REGION_SERVICES[region]
    .slice(0, 4)
    .map((s) => SERVICE_LABEL[s])
    .join(", ");
  const country =
    region === "ca"
      ? "Canada"
      : region === "gb"
        ? "the UK"
        : region === "au"
          ? "Australia"
          : "the US";
  const title = `sunday movies — top-rated films streaming on ${services} (${country})`;
  const description = `Find the best movies and TV streaming on ${services} and more in ${country}. Filtered to titles with 7.0+ IMDb scores so you skip the noise.`;
  return {
    title,
    description,
    alternates: { canonical: "/" },
    openGraph: {
      title,
      description,
      url: "https://sundaymovies.io/",
      type: "website",
    },
  };
}

async function loadMovies(region: Region): Promise<Movie[]> {
  const file = path.join(process.cwd(), "public", `movies-${region}.json`);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as Movie[];
  } catch {
    return [];
  }
}

function parseMulti<T extends string>(
  raw: string | undefined,
  valid: readonly T[],
): T[] {
  if (!raw) return [];
  const validSet = new Set<string>(valid);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => validSet.has(s));
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    kinds?: string;
    services?: string;
    ratings?: string;
    lang?: string;
  }>;
}) {
  const sp = await searchParams;
  const region = await getRegion();
  const cookieStore = await cookies();
  // Default to movies-only when `kinds` is absent. Explicit `?kinds=` (empty)
  // means the user has cleared selection — show nothing, matching sidebar UX.
  const kinds: Kind[] =
    sp.kinds === undefined ? ["movie"] : parseMulti<Kind>(sp.kinds, KINDS);
  // URL `?services=` wins (so shared/filtered links still work). When absent,
  // fall back to the saved cookie so returning visitors see their filter on
  // the very first server render — no client-side router.replace, no hero
  // re-render flash from filters being applied a beat after page load.
  const servicesFromUrl = parseMulti<StreamingService>(
    sp.services,
    REGION_SERVICES[region],
  );
  const cookieServices = parseMulti<StreamingService>(
    cookieStore.get("services")?.value,
    REGION_SERVICES[region],
  );
  const services =
    sp.services !== undefined ? servicesFromUrl : cookieServices;
  const hasOnboarded = cookieStore.get("services-onboarded")?.value === "1";
  const ratings = parseMulti<Certification>(sp.ratings, CERTIFICATIONS);
  // English-only is the default. `?lang=all` opts back into foreign titles.
  const englishOnly = sp.lang !== "all";
  const all = await loadMovies(region);

  if (all.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24">
        <h1
          className="text-[64px] leading-[0.85] font-semibold text-white"
          style={{ letterSpacing: "-0.055em" }}
        >
          sunday movies
        </h1>
        <p className="mt-6 text-[15px] text-[color:var(--silver)]">
          No data yet. Run{" "}
          <code
            className="rounded-[8px] px-2 py-1 text-[13px] text-white"
            style={{
              background: "rgba(255, 255, 255, 0.1)",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            npm run fetch-data
          </code>
          .
        </p>
      </main>
    );
  }

  const movies = filterByEnglishOnly(
    filterByCertifications(
      filterByServices(filterByKinds(all, kinds), services),
      ratings,
    ),
    englishOnly,
  );

  // Serialize current filters so "View all" links carry them forward.
  const currentQuery = (() => {
    const params = new URLSearchParams();
    params.set("kinds", kinds.join(","));
    if (services.length) params.set("services", services.join(","));
    if (ratings.length) params.set("ratings", ratings.join(","));
    if (!englishOnly) params.set("lang", "all");
    return params.toString();
  })();
  const collectionHref = (slug: string, qs: string) =>
    qs ? `/c/${slug}?${qs}` : `/c/${slug}`;

  const heroCandidates = movies.filter((m) => m.backdropPath && m.posterPath);
  // Shuffle among the top 25 quality titles so the featured hero varies
  // between revalidations — the default pool (n+10 floor) would only ever
  // rotate the same ~11 movies.
  const hero = topN(heroCandidates, 1, false, 25)[0] ?? null;

  // Genre order is data-driven: Drama + Comedy lead every survey of US
  // streaming viewers (Statista, Parrot, S&P), then Action / Thriller /
  // Crime / Horror form the next tier by household reach. Mystery is bumped
  // ahead of Thriller per product call (Knives Out era engagement).
  const genres = [
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
  // Decades sit below the genres as a secondary browse surface — kept the
  // three most-watched eras for streaming-era viewers, dropped 2000s/80s/70s
  // as filler.
  const decades = [2020, 2010, 1990];

  return (
    <main>
      <Suspense fallback={null}>
        <OnboardingModal region={region} hasOnboarded={hasOnboarded} />
      </Suspense>
      <div className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-black/40 backdrop-blur-md">
        <nav className="flex items-center justify-between px-3 py-3 sm:px-8 sm:py-3.5 lg:px-16">
          <FiltersDrawer
            region={region}
            defaultServicesCount={cookieServices.length}
          />
          <div className="flex items-center gap-2">
            <RandomButton />
            <CoffeeButton />
            <SearchButton region={region} preferredServices={services} />
          </div>
        </nav>
      </div>

      {hero && <Hero movie={hero} region={region} preferredServices={services} />}

      <div className="pb-16">
        {movies.length === 0 ? (
          <div
            className="mx-6 rounded-[15px] p-10 text-center text-[14px] text-[color:var(--silver)] lg:mx-10"
            style={{ boxShadow: "rgba(0, 0, 0, 0.6) 0px 0px 0px 1px" }}
          >
            No movies match these filters. Open Filters and clear some.
          </div>
        ) : (
          <>
            {/* Lead with genres — the catalog itself already filters to >7
                IMDb so a separate "all-time best" rail was redundant with
                the hero (which rotates through the top 25). */}
            {genres.map((g) => (
              <Rail
                key={g}
                title={`Best ${g.toLowerCase()}`}
                movies={byGenre(movies, g, 20)}
                totalCount={collectionCount({ kind: "genre", name: g }, movies)}
                viewAllHref={collectionHref(genreSlug(g), currentQuery)}
                region={region}
                preferredServices={services}
                collectionSlug={genreSlug(g)}
              />
            ))}

            {decades.map((d) => (
              <Rail
                key={d}
                title={`Best of ${decadeLabel(d)}`}
                movies={byDecade(movies, d, 20)}
                totalCount={collectionCount(
                  { kind: "decade", start: d },
                  movies,
                )}
                viewAllHref={collectionHref(decadeSlug(d), currentQuery)}
                region={region}
                preferredServices={services}
                collectionSlug={decadeSlug(d)}
              />
            ))}
          </>
        )}
      </div>

      <footer className="mx-auto max-w-7xl border-t border-white/[0.06] px-6 py-8 text-[11px] leading-[1.6] text-white/40 lg:px-10">
        <p>
          Streaming service names and logos are trademarks of their respective
          owners. sunday movies is a personal project — not affiliated with,
          endorsed by, or sponsored by any streaming service.
        </p>
        <p className="mt-2 text-white/25">
          This product uses the{" "}
          <a
            href="https://www.themoviedb.org/"
            className="underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            TMDB
          </a>{" "}
          API but is not endorsed or certified by TMDB. Title metadata and
          ratings from{" "}
          <a
            href="https://developer.imdb.com/non-commercial-datasets/"
            className="underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            IMDb&rsquo;s non-commercial dataset
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
