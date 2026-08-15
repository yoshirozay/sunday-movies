"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  type Movie,
  type Region,
  type StreamingService,
} from "@/lib/types";
import { getStreamingTarget, imdbUrl } from "@/lib/streaming";
import { RandomModal, type RandomPick } from "./random-modal";

type ModalContext = {
  /** Open the modal seeded with a specific movie (e.g. tapped from a card).
   *  `collectionSlug` scopes "Try another" to that pool. */
  openMovie: (
    movie: Movie,
    options?: {
      collectionSlug?: string;
      preferredServices?: StreamingService[];
      region?: Region;
    },
  ) => void;
  /** Open the modal with a fresh random pick (Surprise me). */
  surpriseMe: () => void;
  /** Whether a fetch is in-flight with no current pick — for the trigger button. */
  surpriseLoading: boolean;
  surpriseError: string | null;
};

const Ctx = createContext<ModalContext | null>(null);

export function useMovieModal(): ModalContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useMovieModal must be used inside <MovieModalProvider>");
  }
  return ctx;
}

function toPick(
  movie: Movie,
  preferred: StreamingService[],
  region: Region,
): RandomPick {
  const target = getStreamingTarget(movie, preferred, region);
  return {
    movie: {
      id: movie.id,
      kind: movie.kind,
      title: movie.title,
      year: movie.year,
      runtime: movie.runtime,
      genres: movie.genres,
      rating: movie.rating,
      certification: movie.certification ?? null,
      overview: movie.overview ?? null,
      posterPath: movie.posterPath ?? null,
      backdropPath: movie.backdropPath ?? null,
      originalLanguage: movie.originalLanguage ?? null,
    },
    target: target
      ? { service: target.service, url: target.url, label: target.label }
      : { service: null, url: imdbUrl(movie), label: "View on IMDb" },
  };
}

export function MovieModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [history, setHistory] = useState<RandomPick[]>([]);
  const [index, setIndex] = useState(-1);
  const [collectionSlug, setCollectionSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  // True once we've pushed a /m or /t entry for this modal session — first
  // open pushes (so browser back closes the modal), Try Another / in-modal
  // back replace (so closing pops once back to the original location).
  const urlPushedRef = useRef(false);
  // Snapshot of the grid's filter query string, captured when a modal session
  // opens — before we rewrite the URL to /m/{id}, which strips the query.
  // fetchAndAppend reads this so "Try another" keeps the user's filters.
  const filterSearchRef = useRef("");

  useEffect(() => {
    setMounted(true);
  }, []);

  const pick = index >= 0 ? history[index] ?? null : null;
  const canBack = index > 0;
  const isOpen = pick != null;

  const resetState = useCallback(() => {
    setHistory([]);
    setIndex(-1);
    setCollectionSlug(null);
    setError(null);
  }, []);

  const close = useCallback(() => {
    resetState();
    // Pop the URL we pushed so back button history stays clean. If we never
    // pushed (modal was opened by URL sync from a popstate), skip.
    if (urlPushedRef.current && typeof window !== "undefined") {
      urlPushedRef.current = false;
      window.history.back();
    }
  }, [resetState]);

  const fetchAndAppend = useCallback(
    async (slug: string | null, excludeId: string | null) => {
      setLoading(true);
      setError(null);
      try {
        // Filter params come from the snapshot taken when the session opened
        // (filterSearchRef), not window.location — the modal rewrites the URL
        // to /m/{id}, which would otherwise drop the query on "Try another".
        // This also keeps us from subscribing to navigation (no app-wide
        // Suspense boundary).
        const qp = new URLSearchParams(filterSearchRef.current);
        if (slug) qp.set("collection", slug);
        else qp.delete("collection");
        if (excludeId) qp.set("exclude", excludeId);
        else qp.delete("exclude");
        const res = await fetch(`/api/random?${qp.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "Couldn't pick anything.");
          return;
        }
        const data = (await res.json()) as RandomPick;
        setHistory((prev) => {
          // If the user went back then triggered a new pick, drop the
          // forward tail so navigation history stays linear.
          const truncated = prev.slice(0, index + 1);
          return [...truncated, data];
        });
        setIndex((i) => i + 1);
      } catch {
        setError("Network error.");
      } finally {
        setLoading(false);
      }
    },
    [index],
  );

  const openMovie = useCallback<ModalContext["openMovie"]>(
    (movie, options) => {
      // Capture filters now (card tapped on the grid) so "Try another" in this
      // session respects the user's selection.
      filterSearchRef.current =
        typeof window !== "undefined" ? window.location.search : "";
      const preferred = options?.preferredServices ?? [];
      setHistory([toPick(movie, preferred, options?.region ?? "ca")]);
      setIndex(0);
      setCollectionSlug(options?.collectionSlug ?? null);
      setError(null);
    },
    [],
  );

  const surpriseMe = useCallback(() => {
    // Capture the grid's current filters before the modal rewrites the URL.
    filterSearchRef.current =
      typeof window !== "undefined" ? window.location.search : "";
    setHistory([]);
    setIndex(-1);
    setCollectionSlug(null);
    fetchAndAppend(null, null);
  }, [fetchAndAppend]);

  const goBack = useCallback(() => {
    if (canBack) setIndex((i) => i - 1);
  }, [canBack]);

  const goForward = useCallback(() => {
    if (loading) return;
    if (index < history.length - 1) {
      setIndex((i) => i + 1);
    } else {
      const current = history[index];
      fetchAndAppend(collectionSlug, current?.movie.id ?? null);
    }
  }, [loading, index, history, collectionSlug, fetchAndAppend]);

  // Sync URL with the open modal. Uses the History API directly so the
  // underlying page (e.g. `/`) stays mounted — no Next router navigation,
  // no flicker from re-rendering the home grid. Direct visits to `/m/X`
  // still hit the canonical page server-side.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!pick) return;
    const targetPath = `/${pick.movie.kind === "tv" ? "t" : "m"}/${pick.movie.id}`;
    if (window.location.pathname === targetPath) return;
    if (urlPushedRef.current) {
      window.history.replaceState(window.history.state, "", targetPath);
    } else {
      window.history.pushState(window.history.state, "", targetPath);
      urlPushedRef.current = true;
    }
  }, [pick]);

  // Browser back/forward: if user navigates away from a /m or /t URL while
  // the modal is open, dismiss it. We don't manage history here — the URL
  // already changed; we just sync state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      if (!urlPushedRef.current) return;
      const path = window.location.pathname;
      if (!/^\/(m|t)\//.test(path)) {
        urlPushedRef.current = false;
        resetState();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [resetState]);

  // Keyboard: ESC closes, arrow keys navigate. Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowLeft" && canBack) {
        e.preventDefault();
        goBack();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, close, goBack, goForward, canBack]);

  return (
    <Ctx.Provider
      value={{
        openMovie,
        surpriseMe,
        surpriseLoading: loading && !pick,
        surpriseError: !pick ? error : null,
      }}
    >
      {children}
      {mounted &&
        pick &&
        createPortal(
          <RandomModal
            pick={pick}
            loading={loading}
            canBack={canBack}
            onBack={goBack}
            onForward={goForward}
            onClose={close}
          />,
          document.body,
        )}
    </Ctx.Provider>
  );
}
