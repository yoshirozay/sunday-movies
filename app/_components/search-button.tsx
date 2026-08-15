"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  posterUrl,
  type Movie,
  type Region,
  type StreamingService,
} from "@/lib/types";
import { tmdbImageLoader } from "@/lib/tmdb-image-loader";
import { useMovieModal } from "./movie-modal-provider";

const NAV_OFFSET = "64px";
const MAX_RESULTS = 60;

// Per-region cache so switching regions doesn't return stale results.
const cache = new Map<Region, Movie[]>();
const inflight = new Map<Region, Promise<Movie[]>>();

async function loadMovies(region: Region): Promise<Movie[]> {
  const cached = cache.get(region);
  if (cached) return cached;
  const pending = inflight.get(region);
  if (pending) return pending;
  const promise = fetch(`/movies-${region}.json`)
    .then((r) => r.json() as Promise<Movie[]>)
    .then((m) => {
      cache.set(region, m);
      inflight.delete(region);
      return m;
    })
    .catch(() => {
      inflight.delete(region);
      return [];
    });
  inflight.set(region, promise);
  return promise;
}

export function SearchButton({
  region,
  preferredServices = [],
}: {
  region: Region;
  preferredServices?: StreamingService[];
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search movies and TV"
        className="inline-flex items-center gap-2 rounded-full bg-[color:var(--frosted)] px-2.5 py-2 text-[12px] font-medium text-white transition-colors hover:bg-[color:var(--frosted-strong)] sm:px-3.5"
        style={{ letterSpacing: "-0.01em", touchAction: "manipulation" }}
      >
        <SearchIcon />
        <span className="hidden sm:inline">Search</span>
      </button>

      {mounted &&
        open &&
        createPortal(
          <SearchOverlay
            region={region}
            onClose={() => setOpen(false)}
            preferredServices={preferredServices}
          />,
          document.body,
        )}
    </>
  );
}

function SearchOverlay({
  region,
  onClose,
  preferredServices,
}: {
  region: Region;
  onClose: () => void;
  preferredServices: StreamingService[];
}) {
  const { openMovie } = useMovieModal();
  const [movies, setMovies] = useState<Movie[]>(cache.get(region) ?? []);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const deferred = useDeferredValue(query);

  useEffect(() => {
    let cancelled = false;
    void loadMovies(region).then((m) => {
      if (!cancelled) setMovies(m);
    });
    return () => {
      cancelled = true;
    };
  }, [region]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: Movie[] = [];
    for (const m of movies) {
      if (!m.posterPath) continue;
      if (!m.title.toLowerCase().includes(q)) continue;
      out.push(m);
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }, [deferred, movies]);

  const showHint = deferred.trim().length < 2;

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-40 bg-black/80"
        style={{ top: NAV_OFFSET }}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="drawer-slide-in fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden bg-black"
        style={{ top: NAV_OFFSET }}
        role="dialog"
        aria-label="Search"
      >
        <div className="border-b border-white/[0.06] px-4 py-3 sm:px-8 lg:px-16">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="flex flex-1 items-center gap-3 rounded-full bg-[color:var(--frosted)] px-4 py-2.5">
              <SearchIcon size={14} dim />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search movies and TV…"
                className="flex-1 bg-transparent text-[14px] text-white placeholder:text-white/45 focus:outline-none"
                style={{ letterSpacing: "-0.01em" }}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {!showHint && (
                <span className="text-[11px] tabular-nums text-white/50">
                  {results.length}
                  {results.length >= MAX_RESULTS ? "+" : ""}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close search"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--frosted)] text-white transition-colors hover:bg-[color:var(--frosted-strong)]"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-16">
          {showHint ? (
            <p className="mt-10 text-center text-[13px] text-[color:var(--silver)]">
              Type at least 2 characters to search.
            </p>
          ) : results.length === 0 ? (
            <p className="mx-auto mt-10 max-w-md text-center text-[13px] text-[color:var(--silver)]">
              Not currently streaming on any platforms in your country, or it
              isn&apos;t 7.0+ on IMDb (8.0+ for TV).
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
              {results.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      openMovie(m, { preferredServices, region });
                      onClose();
                    }}
                    className="group block w-full overflow-hidden rounded-[10px] bg-[#111] text-left transition-transform duration-200 hover:scale-[1.04] hover:z-10"
                    style={{ aspectRatio: "2 / 3", touchAction: "manipulation" }}
                    title={m.title}
                  >
                    {m.posterPath ? (
                      <Image
                        src={posterUrl(m.posterPath, "w185") ?? ""}
                        alt={m.title}
                        width={185}
                        height={278}
                        loader={tmdbImageLoader}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center p-3 text-center text-[13px] font-medium text-white/80">
                        {m.title}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="pointer-events-none h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
      <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
    </svg>
  );
}

function SearchIcon({ size = 14, dim = false }: { size?: number; dim?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="pointer-events-none shrink-0"
      width={size}
      height={size}
      fill="none"
      stroke={dim ? "rgba(255,255,255,0.55)" : "currentColor"}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  );
}
