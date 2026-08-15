"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  backdropUrl,
  languageLabel,
  type Movie,
  type Region,
  type StreamingService,
} from "@/lib/types";
import { getStreamingTarget, imdbUrl } from "@/lib/streaming";
import { tmdbImageLoader } from "@/lib/tmdb-image-loader";
import { track } from "@/lib/analytics";

// useLayoutEffect on the server warns; fall back to useEffect during SSR.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function Hero({
  movie,
  region,
  preferredServices = [],
}: {
  movie: Movie;
  /** Visitor's region — picks the right storefront for search-URL fallbacks. */
  region: Region;
  preferredServices?: StreamingService[];
}) {
  const backdrop = backdropUrl(movie.backdropPath, "original");
  const target = getStreamingTarget(movie, preferredServices, region);
  const cta = target ?? { url: imdbUrl(movie), label: "View on IMDb" };

  const [expanded, setExpanded] = useState(false);
  // Line-clamp can't animate, so we apply it only when fully collapsed. During
  // the collapse transition we keep it off so max-height animates smoothly,
  // then add the clamp (and the "…") once the animation finishes.
  const [clamped, setClamped] = useState(true);
  const [fullHeight, setFullHeight] = useState(0);
  const descRef = useRef<HTMLParagraphElement>(null);

  // Measure the natural height of the full description so the expand
  // animation runs to the exact content height (not past it, which would
  // stop the animation partway through and feel janky).
  useIsomorphicLayoutEffect(() => {
    const el = descRef.current;
    if (!el) return;
    const measure = () => {
      const prevMax = el.style.maxHeight;
      const prevDisplay = el.style.display;
      const prevClamp = el.style.webkitLineClamp;
      el.style.maxHeight = "none";
      el.style.display = "block";
      el.style.webkitLineClamp = "unset";
      setFullHeight(el.scrollHeight);
      el.style.maxHeight = prevMax;
      el.style.display = prevDisplay;
      el.style.webkitLineClamp = prevClamp;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [movie.overview]);

  // Toggle clamp in sync with the animation: off immediately on expand; on
  // only after the 300ms collapse transition finishes.
  useEffect(() => {
    if (expanded) {
      setClamped(false);
      return;
    }
    const t = window.setTimeout(() => setClamped(true), 300);
    return () => window.clearTimeout(t);
  }, [expanded]);

  // Tapping outside the description collapses it. Delay attaching the listener
  // by one tick so the same tap that opens it doesn't immediately close it.
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (descRef.current && !descRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("click", handler);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", handler);
    };
  }, [expanded]);

  return (
    <section className="relative mb-20 mt-16 h-[82vh] min-h-[540px] w-full overflow-hidden">
      {backdrop && (
        <Image
          src={backdrop}
          alt=""
          fill
          priority
          sizes="100vw"
          loader={tmdbImageLoader}
          className="object-cover"
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/90 via-black/30 to-transparent" />
      {/* Top fade so the floating nav is always readable, even when a long
          title pushes upward into this area. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/85 via-black/40 to-transparent" />

      <div className="absolute inset-x-0 bottom-0">
        <div className="px-8 pb-24 pt-32 lg:px-16">
          <div className="max-w-3xl">
            <span
              className="text-[11px] font-medium uppercase text-[color:var(--silver)]"
              style={{ letterSpacing: "0.18em" }}
            >
              Featured
            </span>
            <h1
              className="mt-4 line-clamp-3 text-[34px] font-semibold leading-[1.05] text-white sm:text-[72px] sm:leading-[1.02] lg:text-[84px]"
              style={{ letterSpacing: "-0.045em" }}
            >
              {movie.title}
            </h1>
            <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] sm:mt-5 sm:gap-4 sm:text-[20px]">
              <span
                className="font-mono tabular-nums"
                style={{ color: "var(--framer-blue)" }}
              >
                {movie.rating.toFixed(1)}
              </span>
              <span className="text-[color:var(--silver)]">{movie.year}</span>
              {movie.runtime && (
                <span className="text-[color:var(--silver)]">
                  {movie.runtime}m
                </span>
              )}
              {movie.certification && movie.certification !== "NR" && (
                <span className="rounded-[4px] border border-white/40 px-1.5 py-0.5 text-[10px] font-semibold text-white/80 sm:px-2 sm:text-[14px]">
                  {movie.certification}
                </span>
              )}
              {languageLabel(movie.originalLanguage) && (
                <span className="text-[color:var(--silver)]">
                  {languageLabel(movie.originalLanguage)}
                </span>
              )}
              <span
                className="truncate text-[color:var(--silver)]"
                style={{ letterSpacing: "-0.005em" }}
              >
                {movie.genres.slice(0, 3).join(" · ")}
              </span>
            </div>
            {movie.overview && (
              <p
                ref={descRef}
                onClick={() => setExpanded((v) => !v)}
                className={`mt-4 max-w-xl cursor-pointer select-none overflow-hidden text-[14px] leading-[1.5] text-white/80 transition-[max-height] duration-300 ease-out sm:mt-6 sm:text-[22px] sm:leading-[1.45] ${
                  clamped ? "line-clamp-3" : ""
                }`}
                style={{
                  letterSpacing: "-0.01em",
                  maxHeight: expanded
                    ? fullHeight > 0
                      ? `${fullHeight}px`
                      : "600px"
                    : "4.5em",
                }}
              >
                {movie.overview}
              </p>
            )}
            <div className="mt-8 flex items-center gap-3 sm:gap-4">
              <a
                href={cta.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  track("cta_click", {
                    source: "hero",
                    service: target?.service ?? "imdb",
                    title: movie.title,
                    id: movie.id,
                    genres: movie.genres.join(","),
                  })
                }
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-black transition hover:bg-white/90 sm:gap-3 sm:px-9 sm:py-4 sm:text-[20px]"
                style={{ letterSpacing: "-0.01em" }}
              >
                {cta.label}
                <span aria-hidden>→</span>
              </a>
              {target && (
                <a
                  href={imdbUrl(movie)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-[color:var(--frosted)] px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-[color:var(--frosted-strong)] sm:px-8 sm:py-4 sm:text-[19px]"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  IMDb
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
