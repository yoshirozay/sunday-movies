import { MovieCard } from "./movie-card";
import { ScrollableRow } from "./scrollable-row";
import { ViewAllCard } from "./view-all-card";
import type { Movie, Region, StreamingService } from "@/lib/types";

export function Rail({
  title,
  movies,
  region,
  preferredServices = [],
  viewAllHref,
  totalCount,
  collectionSlug,
}: {
  title: string;
  movies: Movie[];
  /** Visitor's region — picks the right storefront for search-URL fallbacks. */
  region: Region;
  preferredServices?: StreamingService[];
  viewAllHref?: string;
  totalCount?: number;
  /** Scopes "Try another" in the detail modal to this collection. */
  collectionSlug?: string;
}) {
  if (movies.length === 0) return null;
  const showViewAll =
    viewAllHref != null && totalCount != null && totalCount > movies.length;
  return (
    <section className="mb-10">
      <header className="mb-3 flex items-baseline gap-3 px-8 lg:px-16">
        <h2
          className="text-[32px] font-semibold text-white sm:text-[34px]"
          style={{ letterSpacing: "-0.03em" }}
        >
          {title}
        </h2>
      </header>
      <ScrollableRow>
        {movies.map((m) => (
          <div key={m.id} className="snap-start">
            <MovieCard
              movie={m}
              region={region}
              preferredServices={preferredServices}
              collectionSlug={collectionSlug}
            />
          </div>
        ))}
        {showViewAll && (
          <div className="snap-start">
            <ViewAllCard href={viewAllHref} count={totalCount} />
          </div>
        )}
      </ScrollableRow>
    </section>
  );
}
