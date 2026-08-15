"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { backdropUrl, languageLabel, posterUrl } from "@/lib/types";
import { tmdbImageLoader } from "@/lib/tmdb-image-loader";
import { track } from "@/lib/analytics";
import { SaveButton } from "./save-button";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type RandomPick = {
  movie: {
    id: string;
    kind: "movie" | "tv";
    title: string;
    year: number | null;
    runtime: number | null;
    genres: string[];
    rating: number;
    certification: string | null;
    overview: string | null;
    posterPath: string | null;
    backdropPath: string | null;
    originalLanguage: string | null;
  };
  target: {
    service: string | null;
    url: string;
    label: string;
  };
};

export function RandomModal({
  pick,
  loading,
  canBack,
  onBack,
  onForward,
  onClose,
}: {
  pick: RandomPick;
  loading: boolean;
  canBack: boolean;
  onBack: () => void;
  onForward: () => void;
  onClose: () => void;
}) {
  const { movie, target } = pick;
  const backdrop = backdropUrl(movie.backdropPath, "w1280");
  const poster = posterUrl(movie.posterPath, "w500");

  // Focus the primary "Watch" CTA when the modal opens so Enter activates it
  // via the browser's default link-activation behavior. We only focus once
  // (on mount) so subsequent next/back nav doesn't yank focus from the arrows.
  const watchRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    watchRef.current?.focus();
  }, []);

  // Tap-to-expand description. Tapping elsewhere collapses it. We measure
  // the natural content height so the max-height animation runs to an exact
  // target (smooth all the way through) instead of overshooting and feeling
  // like it stops partway.
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(true);
  const [fullHeight, setFullHeight] = useState(0);
  const descRef = useRef<HTMLParagraphElement>(null);

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

  useEffect(() => {
    if (expanded) {
      setClamped(false);
      return;
    }
    const t = window.setTimeout(() => setClamped(true), 300);
    return () => window.clearTimeout(t);
  }, [expanded]);

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
  // Reset when the user navigates to a new random pick
  useEffect(() => {
    setExpanded(false);
  }, [movie.id]);

  return (
    <>
      {/* Dim backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/85"
        onClick={onClose}
        aria-hidden
      />

      {/* Centered modal */}
      <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
        <div
          role="dialog"
          aria-label="Random pick"
          className="random-modal-enter pointer-events-auto relative aspect-[2/3] w-full max-w-7xl overflow-hidden rounded-[20px] bg-black sm:aspect-[16/9] sm:rounded-[24px]"
          style={{
            boxShadow:
              "rgba(0, 0, 0, 0.7) 0px 0px 0px 1px, rgba(0, 0, 0, 0.5) 0px 40px 100px",
            maxHeight: "92vh",
          }}
        >
          {/* Mobile uses poster (portrait), desktop uses backdrop (landscape) */}
          {poster && (
            <Image
              key={`po-${movie.id}`}
              src={poster}
              alt=""
              fill
              priority
              sizes="100vw"
              loader={tmdbImageLoader}
              className="object-cover sm:hidden"
            />
          )}
          {backdrop ? (
            <Image
              key={`bd-${movie.id}`}
              src={backdrop}
              alt=""
              fill
              priority
              sizes="(min-width: 1024px) 1024px, 100vw"
              loader={tmdbImageLoader}
              className="hidden object-cover sm:block"
            />
          ) : poster ? (
            <Image
              key={`po-bg-${movie.id}`}
              src={poster}
              alt=""
              fill
              priority
              sizes="(min-width: 1024px) 1024px, 100vw"
              loader={tmdbImageLoader}
              className="hidden object-cover opacity-50 blur-xl sm:block"
            />
          ) : null}

          {/* Gradients */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/55 to-transparent" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/30 to-transparent" />

          {/* Top-right controls: save + close, grouped so they read as one
           *  unit instead of competing with the close button. */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2 sm:right-6 sm:top-6">
            <SaveButton
              tconst={movie.id}
              title={movie.title}
              genres={movie.genres}
              variant="modal"
            />
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 sm:h-12 sm:w-12"
              style={{
                background: "rgba(0, 0, 0, 0.55)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
              }}
            >
              <svg
                viewBox="0 0 14 14"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M2 2 L12 12 M12 2 L2 12" />
              </svg>
            </button>
          </div>

          {/* Back arrow (left edge) — only if there's history.
           *  Hidden on mobile since the cramped portrait layout can't spare
           *  the horizontal real estate; desktop keeps the arrow.
           *  There's no matching forward arrow — "Try another" handles that
           *  at both breakpoints. */}
          {canBack && (
            <NavArrow
              direction="left"
              onClick={onBack}
              ariaLabel="Previous pick"
            />
          )}

          {/* Bottom content */}
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-12 lg:p-16">
            {/* Internal px reserves space for the back/forward arrows so the
                title doesn't sit underneath them. Smaller on mobile since
                arrows are also smaller/closer. */}
            <div className="max-w-4xl sm:px-20">
              <h2
                className="line-clamp-2 text-[26px] font-semibold leading-[1.05] text-white sm:text-[60px] sm:leading-[1.02] lg:text-[72px]"
                style={{ letterSpacing: "-0.04em" }}
              >
                {movie.title}
              </h2>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] sm:mt-5 sm:gap-x-4 sm:text-[20px]">
                <span
                  className="font-mono tabular-nums"
                  style={{ color: "var(--framer-blue)" }}
                >
                  {movie.rating.toFixed(1)}
                </span>
                {movie.year && (
                  <span className="text-[color:var(--silver)]">
                    {movie.year}
                  </span>
                )}
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
                  className={`mt-3 max-w-xl cursor-pointer select-none overflow-hidden text-[13px] leading-[1.5] text-white/80 transition-[max-height] duration-300 ease-out sm:mt-5 sm:text-[20px] ${
                    clamped ? "line-clamp-4" : ""
                  }`}
                  style={{
                    letterSpacing: "-0.01em",
                    maxHeight: expanded
                      ? fullHeight > 0
                        ? `${fullHeight}px`
                        : "500px"
                      : "6em",
                  }}
                >
                  {movie.overview}
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-3 sm:mt-7 sm:gap-4">
                <a
                  ref={watchRef}
                  href={target.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    track("cta_click", {
                      source: "modal",
                      service: target.service ?? "imdb",
                      title: movie.title,
                      id: movie.id,
                      genres: movie.genres.join(","),
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-black outline-none transition hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-[color:var(--framer-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:gap-3 sm:px-8 sm:py-4 sm:text-[20px]"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {target.label}
                  <span aria-hidden>→</span>
                </a>
                {/* Back + Try another grouped so they stay on the same row
                 *  when wrapping. Back is mobile-only — desktop uses the
                 *  side nav arrow instead. */}
                <div className="flex items-center gap-3 sm:gap-4">
                  {canBack && (
                    <button
                      type="button"
                      onClick={onBack}
                      aria-label="Previous pick"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--frosted)] text-white transition hover:bg-[color:var(--frosted-strong)] sm:hidden"
                      style={{ touchAction: "manipulation" }}
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="pointer-events-none h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="10,3 5,8 10,13" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      track("try_another", { from_id: movie.id });
                      onForward();
                    }}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-full bg-[color:var(--frosted)] px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-[color:var(--frosted-strong)] disabled:opacity-60 sm:gap-3 sm:px-7 sm:py-4 sm:text-[20px]"
                    style={{ letterSpacing: "-0.01em" }}
                  >
                    <Refresh spinning={loading} />
                    <span>{loading ? "Picking…" : "Try another"}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes randomModalIn {
          from { transform: scale(0.96); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .random-modal-enter {
          animation: randomModalIn 200ms cubic-bezier(0.22, 1, 0.36, 1);
        }
      `}</style>
    </>
  );
}

function NavArrow({
  direction,
  onClick,
  ariaLabel,
  loading,
}: {
  direction: "left" | "right";
  onClick: () => void;
  ariaLabel: string;
  loading?: boolean;
}) {
  const positionClass = direction === "left" ? "sm:left-6" : "sm:right-6";
  return (
    <button
      onClick={onClick}
      disabled={loading}
      aria-label={ariaLabel}
      className={`absolute ${positionClass} top-1/2 z-10 hidden h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full text-white transition-all hover:scale-105 disabled:opacity-60 disabled:cursor-wait sm:flex`}
      style={{
        background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "rgba(0, 0, 0, 0.7) 0px 0px 0px 1px",
      }}
    >
      {loading && direction === "right" ? (
        <Spinner />
      ) : (
        <svg
          viewBox="0 0 16 16"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: direction === "left" ? "rotate(180deg)" : undefined,
          }}
        >
          <polyline points="6,3 11,8 6,13" />
        </svg>
      )}
    </button>
  );
}

function Refresh({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={"h-3.5 w-3.5 " + (spinning ? "animate-spin" : "")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2 V6 H10" />
      <path d="M14 6 A6 6 0 1 1 12 3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M14 8 A6 6 0 1 1 8 2" />
    </svg>
  );
}
