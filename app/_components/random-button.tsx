"use client";

import { track } from "@/lib/analytics";
import { useMovieModal } from "./movie-modal-provider";

export function RandomButton() {
  const { surpriseMe, surpriseLoading, surpriseError } = useMovieModal();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          track("surprise_me");
          surpriseMe();
        }}
        disabled={surpriseLoading}
        aria-label="Pick a random movie"
        className="inline-flex items-center gap-2 rounded-full bg-[color:var(--frosted)] px-3.5 py-2 text-[12px] font-medium text-white transition-colors hover:bg-[color:var(--frosted-strong)] disabled:opacity-60"
        style={{ letterSpacing: "-0.01em", touchAction: "manipulation" }}
      >
        <Shuffle spinning={surpriseLoading} />
        <span>{surpriseLoading ? "Picking…" : "Surprise me"}</span>
      </button>

      {surpriseError && (
        <span
          role="status"
          className="ml-3 hidden text-[11px] text-[color:var(--silver)] sm:inline"
        >
          {surpriseError}
        </span>
      )}
    </>
  );
}

function Shuffle({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={"pointer-events-none h-3.5 w-3.5 " + (spinning ? "animate-spin" : "")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="11,2 14,5 11,8" />
      <path d="M14 5 H9 C5 5 4 12 1 12" />
      <polyline points="11,8 14,11 11,14" />
      <path d="M14 11 H9 C8 11 7.5 10.5 7 9.5" />
    </svg>
  );
}
