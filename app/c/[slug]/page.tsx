import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { cookies } from "next/headers";
import {
  filterByCertifications,
  filterByEnglishOnly,
  filterByKinds,
  filterByServices,
} from "@/lib/curate";
import {
  applyCollection,
  collectionTitle,
  parseCollectionSlug,
} from "@/lib/collections";
import { CoffeeButton } from "@/app/_components/coffee-button";
import { FiltersDrawer } from "@/app/_components/filters-drawer";
import { MovieCard } from "@/app/_components/movie-card";
import { RandomButton } from "@/app/_components/random-button";
import { SearchButton } from "@/app/_components/search-button";

// Reading cookies/headers in getRegion() opts this route into dynamic
// rendering — see app/page.tsx for context.
export const dynamic = "force-dynamic";

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

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    kinds?: string;
    services?: string;
    ratings?: string;
    lang?: string;
  }>;
}) {
  const { slug } = await params;
  const collection = parseCollectionSlug(slug);
  if (!collection) notFound();

  const sp = await searchParams;
  const region = await getRegion();
  const cookieStore = await cookies();
  const kinds: Kind[] =
    sp.kinds === undefined ? ["movie"] : parseMulti<Kind>(sp.kinds, KINDS);
  // Mirror home: URL `?services=` wins, cookie is the fallback. Keeps the
  // sidebar/drawer in sync across pages and respects a returning visitor's
  // saved selection on direct/bookmark loads.
  const cookieServices = parseMulti<StreamingService>(
    cookieStore.get("services")?.value,
    REGION_SERVICES[region],
  );
  const services =
    sp.services !== undefined
      ? parseMulti<StreamingService>(sp.services, REGION_SERVICES[region])
      : cookieServices;
  const ratings = parseMulti<Certification>(sp.ratings, CERTIFICATIONS);
  const englishOnly = sp.lang !== "all";

  const all = await loadMovies(region);
  const filtered = filterByEnglishOnly(
    filterByCertifications(
      filterByServices(filterByKinds(all, kinds), services),
      ratings,
    ),
    englishOnly,
  );
  const items = applyCollection(collection, filtered);
  const title = collectionTitle(collection);

  return (
    <main>
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

      <div className="mx-auto max-w-[1500px] px-6 pb-16 pt-24 lg:px-10">
        <header className="mb-10">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-1 text-[11px] font-medium uppercase text-[color:var(--silver)] transition-colors hover:text-white"
            style={{ letterSpacing: "0.15em" }}
          >
            <span aria-hidden>←</span> Back
          </Link>
          <h1
            className="text-[40px] font-semibold leading-[1.0] text-white sm:text-[56px] lg:text-[72px]"
            style={{ letterSpacing: "-0.04em" }}
          >
            {title}
          </h1>
          <p
            className="mt-3 text-[14px] text-[color:var(--silver)]"
            style={{ letterSpacing: "-0.01em" }}
          >
            {items.length.toLocaleString()}{" "}
            {items.length === 1 ? "title" : "titles"}
          </p>
        </header>

        {items.length === 0 ? (
          <div
            className="rounded-[15px] p-10 text-center text-[14px] text-[color:var(--silver)]"
            style={{ boxShadow: "rgba(0, 0, 0, 0.6) 0px 0px 0px 1px" }}
          >
            Nothing in this collection matches your current filters.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {items.map((m) => (
              <MovieCard
                key={m.id}
                movie={m}
                region={region}
                fillParent
                preferredServices={services}
                collectionSlug={slug}
                hideOverlay
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
