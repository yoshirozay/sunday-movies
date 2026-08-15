"use client";

import { useEffect, useState } from "react";
import { has, subscribe, toggle } from "@/lib/watchlist";
import { track } from "@/lib/analytics";

// Heart toggle for adding/removing a title from the watchlist. Stays in sync
// across tabs and across multiple instances on the same page (e.g. the modal
// opens for a title that also appears in a list grid behind it).
export function SaveButton({
  tconst,
  title,
  genres,
  variant = "modal",
}: {
  tconst: string;
  title: string;
  genres: string[];
  variant?: "modal" | "canonical";
}) {
  const [saved, setSaved] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setSaved(has(tconst));
    return subscribe(() => setSaved(has(tconst)));
  }, [tconst]);

  const onClick = () => {
    const nowSaved = toggle(tconst);
    setSaved(nowSaved);
    if (nowSaved) {
      track("list_save", { id: tconst, title, genres: genres.join(",") });
    } else {
      track("list_remove", { id: tconst });
    }
  };

  // Until mounted we don't know the saved state — render a neutral
  // placeholder to avoid a hydration flash from "unsaved" → "saved".
  if (!mounted) {
    return variant === "canonical" ? (
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.04]" />
    ) : (
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--frosted)]" />
    );
  }

  if (variant === "canonical") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={saved}
        aria-label={saved ? "Remove from list" : "Save to list"}
        className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.08]"
        style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.06)" }}
      >
        <Heart filled={saved} />
        <span>{saved ? "Saved" : "Save"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={saved ? "Remove from list" : "Save to list"}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--frosted)] text-white transition-colors hover:bg-[color:var(--frosted-strong)]"
      style={{ touchAction: "manipulation" }}
    >
      <Heart filled={saved} />
    </button>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="pointer-events-none h-4 w-4"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
