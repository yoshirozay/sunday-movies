"use client";

import Image from "next/image";
import {
  languageLabel,
  posterUrl,
  type Movie,
  type Region,
  type StreamingService,
} from "@/lib/types";
import { getStreamingTarget } from "@/lib/streaming";
import { tmdbImageLoader } from "@/lib/tmdb-image-loader";
import { track } from "@/lib/analytics";
import { useMovieModal } from "./movie-modal-provider";

export function MovieCard({
  movie,
  region,
  width = 300,
  fillParent = false,
  preferredServices = [],
  collectionSlug,
  hideOverlay = false,
}: {
  movie: Movie;
  /** Visitor's region — picks the right storefront for search-URL fallbacks. */
  region: Region;
  /** Fixed pixel width. Ignored when `fillParent` is true. */
  width?: number;
  /** Use 100% width — for grid layouts where the parent column sets width. */
  fillParent?: boolean;
  preferredServices?: StreamingService[];
  /** Scopes "Try another" in the modal to this collection (e.g. "1990s"). */
  collectionSlug?: string;
  /** Suppress the always-on (touch) / hover (desktop) metadata overlay.
   *  Used on dense grids where the gradient + text on every poster gets
   *  visually noisy and the modal already shows everything on tap. */
  hideOverlay?: boolean;
}) {
  const { openMovie } = useMovieModal();
  const url = posterUrl(movie.posterPath, "w342");
  const target = getStreamingTarget(movie, preferredServices, region);
  const sizing = fillParent
    ? { width: "100%" as const, aspectRatio: "2 / 3" }
    : { width, aspectRatio: "2 / 3" };
  const sizes = fillParent
    ? "(min-width: 1280px) 200px, (min-width: 768px) 180px, 33vw"
    : `${width}px`;

  return (
    <button
      type="button"
      onClick={() => {
        track("card_click", {
          id: movie.id,
          title: movie.title,
          kind: movie.kind,
          collection: collectionSlug ?? null,
        });
        openMovie(movie, { collectionSlug, preferredServices, region });
      }}
      className={
        "group relative block overflow-hidden rounded-[10px] bg-[#111] text-left transition-transform duration-200 hover:scale-[1.04] hover:z-10 " +
        (fillParent ? "" : "shrink-0")
      }
      style={{ ...sizing, touchAction: "manipulation" }}
      title={movie.title}
    >
      {url ? (
        <Image
          src={url}
          alt={movie.title}
          fill
          sizes={sizes}
          loader={tmdbImageLoader}
          className="object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-3 text-center">
          <span
            className="text-[13px] font-medium text-white/80"
            style={{ letterSpacing: "-0.015em" }}
          >
            {movie.title}
          </span>
        </div>
      )}

      {/* Hover overlay with rating + title + service.
       *  On touch devices (no hover), always show since :hover never fires. */}
      {!hideOverlay && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <div className="flex items-baseline gap-2">
            <span
              className="font-mono text-[14px] tabular-nums"
              style={{ color: "var(--framer-blue)" }}
            >
              {movie.rating.toFixed(1)}
            </span>
            <span className="text-[14px] tabular-nums text-white/60">
              {movie.year ?? ""}
            </span>
            {languageLabel(movie.originalLanguage) && (
              <span className="text-[13px] text-white/60">
                {languageLabel(movie.originalLanguage)}
              </span>
            )}
            {movie.certification && movie.certification !== "NR" && (
              <span className="ml-auto rounded-[3px] border border-white/30 px-1 text-[12px] font-semibold text-white/70">
                {movie.certification}
              </span>
            )}
          </div>
          <div
            className="mt-0.5 truncate text-[18px] font-medium text-white"
            style={{ letterSpacing: "-0.01em" }}
          >
            {movie.title}
          </div>
          {target && (
            <div
              className="mt-0.5 truncate text-[13px] text-white/70"
              style={{ letterSpacing: "-0.005em" }}
            >
              {target.label}
            </div>
          )}
        </div>
      )}
    </button>
  );
}
