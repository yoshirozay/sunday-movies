"use client";

import type { ReactNode } from "react";
import { track } from "@/lib/analytics";
import type { StreamingService } from "@/lib/types";

// Watch-on-X button on the canonical /m and /t pages. Distinct event source
// ("canonical") so we can compare engagement vs hero/modal CTAs.
export function CanonicalCta({
  href,
  service,
  title,
  tconst,
  genres,
  children,
}: {
  href: string;
  service: StreamingService;
  title: string;
  tconst: string;
  genres: string[];
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() =>
        track("cta_click", {
          source: "canonical",
          service,
          title,
          id: tconst,
          genres: genres.join(","),
        })
      }
      className="flex items-center gap-3 rounded-[12px] bg-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.08]"
      style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.06)" }}
    >
      {children}
    </a>
  );
}
