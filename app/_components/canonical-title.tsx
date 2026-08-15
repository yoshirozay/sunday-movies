import Link from "next/link";
import {
  SERVICE_LABEL,
  SERVICE_LOGO,
  backdropUrl,
  languageLabel,
  posterUrl,
  type Movie,
  type Region,
  type StreamingService,
} from "@/lib/types";
import { imdbUrl, serviceSearchUrl } from "@/lib/streaming";
import { CanonicalBackdrop } from "./canonical-backdrop";
import { CanonicalCta } from "./canonical-cta";
import { SaveButton } from "./save-button";

// Shared canonical-page renderer for /m/[tconst] (movies) and
// /t/[tconst] (TV). Pure server component — pages stay thin.
export function CanonicalTitle({
  movie,
  region,
  foundIn,
}: {
  movie: Movie;
  region: Region;
  foundIn: Region;
}) {
  const backdrop = backdropUrl(movie.backdropPath, "original");
  const services: StreamingService[] = movie.availableOn ?? [];
  const inVisitorRegion = foundIn === region;

  // Schema.org payload — gives Google rich-result eligibility for the
  // long-tail "where to watch X" queries this page targets.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": movie.kind === "tv" ? "TVSeries" : "Movie",
    name: movie.title,
    description: movie.overview ?? undefined,
    image: posterUrl(movie.posterPath, "w780") ?? undefined,
    datePublished: movie.year ? String(movie.year) : undefined,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: movie.rating,
      ratingCount: movie.votes,
      bestRating: 10,
      worstRating: 0,
    },
    sameAs: `https://www.imdb.com/title/${movie.id}/`,
  };

  return (
    <main className="min-h-screen">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="relative h-[60vh] min-h-[420px] w-full overflow-hidden">
        {backdrop && <CanonicalBackdrop src={backdrop} />}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/30 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/85 via-black/40 to-transparent" />
        <div className="absolute inset-x-0 top-0 z-10">
          <nav className="px-6 pt-6 lg:px-12 lg:pt-8">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-[12px] font-medium uppercase text-white/70 transition-colors hover:text-white"
              style={{ letterSpacing: "0.15em" }}
            >
              <span aria-hidden>←</span> sunday movies
            </Link>
          </nav>
        </div>
        <div className="absolute inset-x-0 bottom-0 px-6 pb-10 lg:px-12 lg:pb-14">
          <div className="max-w-4xl">
            <h1
              className="text-[40px] font-semibold leading-[1.02] text-white sm:text-[64px] lg:text-[84px]"
              style={{ letterSpacing: "-0.045em" }}
            >
              {movie.title}
            </h1>
            <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[14px] text-white/80 sm:text-[18px]">
              <span
                className="font-mono tabular-nums"
                style={{ color: "var(--framer-blue)" }}
              >
                {movie.rating.toFixed(1)}
              </span>
              {movie.year && <span className="text-white/60">{movie.year}</span>}
              {movie.runtime && (
                <span className="text-white/60">{movie.runtime}m</span>
              )}
              {movie.certification && movie.certification !== "NR" && (
                <span className="rounded-[4px] border border-white/40 px-2 py-0.5 text-[11px] font-semibold text-white/80 sm:text-[13px]">
                  {movie.certification}
                </span>
              )}
              {languageLabel(movie.originalLanguage) && (
                <span className="text-white/60">
                  {languageLabel(movie.originalLanguage)}
                </span>
              )}
              <span
                className="text-white/60"
                style={{ letterSpacing: "-0.005em" }}
              >
                {movie.genres.slice(0, 3).join(" · ")}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-6 py-10 lg:py-14">
        {!inVisitorRegion && (
          <div
            className="mb-8 rounded-[12px] bg-white/[0.04] px-5 py-4 text-[14px] text-white/80"
            style={{
              boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.06)",
            }}
          >
            Not currently streaming in your region. Available in{" "}
            <span className="font-medium text-white">
              {foundIn === "ca"
                ? "Canada"
                : foundIn === "gb"
                  ? "the United Kingdom"
                  : foundIn === "au"
                    ? "Australia"
                    : "the United States"}
            </span>{" "}
            on {services.map((s) => SERVICE_LABEL[s]).join(", ")}.
          </div>
        )}

        {movie.overview && (
          <p
            className="text-[16px] leading-[1.55] text-white/85 sm:text-[18px]"
            style={{ letterSpacing: "-0.01em" }}
          >
            {movie.overview}
          </p>
        )}

        <section className="mt-10">
          <h2
            className="mb-4 text-[11px] font-medium uppercase text-[color:var(--silver)]"
            style={{ letterSpacing: "0.18em" }}
          >
            Where to watch
          </h2>
          {services.length === 0 ? (
            <p className="text-[14px] text-white/60">
              Not currently available on a tracked streaming service. Try IMDb
              for rental and other options.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {services.map((s) => {
                // Fall back to the service's search page in the region whose
                // catalog the title was found in — "Watch on X" should land
                // on X, not IMDb.
                const url =
                  movie.streamingLinks?.[s] ??
                  serviceSearchUrl(s, movie.title, foundIn);
                return (
                  <li key={s}>
                    <CanonicalCta
                      href={url}
                      service={s}
                      title={movie.title}
                      tconst={movie.id}
                      genres={movie.genres}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={SERVICE_LOGO[s]}
                        alt={SERVICE_LABEL[s]}
                        style={{ height: 18, width: "auto" }}
                      />
                      <span className="text-[14px] font-medium text-white/85">
                        Watch on {SERVICE_LABEL[s]}
                      </span>
                      <span aria-hidden className="ml-auto text-white/40">
                        →
                      </span>
                    </CanonicalCta>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-8 flex flex-wrap items-center gap-4">
          <SaveButton
            tconst={movie.id}
            title={movie.title}
            genres={movie.genres}
            variant="canonical"
          />
          <a
            href={imdbUrl(movie)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[13px] text-white/60 transition-colors hover:text-white"
          >
            View on IMDb <span aria-hidden>↗</span>
          </a>
        </section>
      </div>
    </main>
  );
}
