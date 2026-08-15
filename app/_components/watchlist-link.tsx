"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getList, subscribe } from "@/lib/watchlist";
import { track } from "@/lib/analytics";

// Compact "My list" link for the filters drawer. Renders nothing until
// mounted (avoids a SSR-vs-client mismatch on the count) and nothing when
// the list is empty (zero items = zero UI). Cross-tab updates are wired in
// via the subscribe channel.
export function WatchlistLink() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    setCount(getList().length);
    return subscribe((ids) => setCount(ids.length));
  }, []);

  if (count === null || count === 0) return null;

  return (
    <Link
      href="/list"
      onClick={() => track("list_view", { source: "drawer", count })}
      className="mb-4 flex items-center justify-between rounded-[10px] bg-white/[0.04] px-3 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.08]"
      style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.06)" }}
    >
      <span className="inline-flex items-center gap-2">
        <Heart />
        My List
      </span>
      <span className="font-mono tabular-nums text-[12px] text-white/60">
        {count}
      </span>
    </Link>
  );
}

function Heart() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="currentColor"
      aria-hidden
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
