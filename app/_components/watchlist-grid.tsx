"use client";

import { useEffect, useState } from "react";
import { posterUrl, type Movie, type Region } from "@/lib/types";
import { getList, subscribe } from "@/lib/watchlist";
import { useMovieModal } from "./movie-modal-provider";
import Image from "next/image";
import { tmdbImageLoader } from "@/lib/tmdb-image-loader";

// Loaded once per region per session — same pattern as the search overlay.
const cache = new Map<Region, Movie[]>();

async function loadCatalog(region: Region): Promise<Movie[]> {
  const cached = cache.get(region);
  if (cached) return cached;
  const res = await fetch(`/movies-${region}.json`);
  const data = (await res.json()) as Movie[];
  cache.set(region, data);
  return data;
}

export function WatchlistGrid({ region }: { region: Region }) {
  const { openMovie } = useMovieModal();
  const [ids, setIds] = useState<string[] | null>(null);
  const [movies, setMovies] = useState<Map<string, Movie>>(new Map());

  useEffect(() => {
    setIds(getList());
    return subscribe((next) => setIds(next));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadCatalog(region).then((catalog) => {
      if (cancelled) return;
      const lookup = new Map<string, Movie>();
      for (const m of catalog) lookup.set(m.id, m);
      setMovies(lookup);
    });
    return () => {
      cancelled = true;
    };
  }, [region]);

  if (ids === null) return null; // pre-mount, render nothing

  if (ids.length === 0) {
    return (
      <div
        className="rounded-[15px] p-10 text-center text-[14px] text-[color:var(--silver)]"
        style={{ boxShadow: "rgba(0, 0, 0, 0.6) 0px 0px 0px 1px" }}
      >
        Save anything you want to watch later by tapping the ♡ inside a title.
      </div>
    );
  }

  // Newest saves first — better default than catalog order.
  const ordered = [...ids].reverse();

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
      {ordered.map((id) => {
        const movie = movies.get(id);
        if (!movie) {
          // Title isn't in this region's catalog — render a placeholder so
          // the user can still get to the canonical page (which falls back
          // to the other region).
          return (
            <a
              key={id}
              href={`/m/${id}`}
              className="flex aspect-[2/3] w-full items-center justify-center rounded-[10px] bg-[#111] p-3 text-center text-[12px] text-white/60"
            >
              Open title
            </a>
          );
        }
        const poster = posterUrl(movie.posterPath, "w342");
        return (
          <button
            key={id}
            type="button"
            onClick={() => openMovie(movie, { region })}
            className="group relative block w-full overflow-hidden rounded-[10px] bg-[#111] text-left transition-transform duration-200 hover:scale-[1.04]"
            style={{ aspectRatio: "2 / 3", touchAction: "manipulation" }}
            title={movie.title}
          >
            {poster ? (
              <Image
                src={poster}
                alt={movie.title}
                fill
                sizes="(min-width: 1280px) 200px, (min-width: 768px) 180px, 33vw"
                loader={tmdbImageLoader}
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center p-3 text-center">
                <span className="text-[13px] font-medium text-white/80">
                  {movie.title}
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
