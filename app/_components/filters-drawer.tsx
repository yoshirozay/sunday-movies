"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import type { Region } from "@/lib/types";
import { FiltersSidebar } from "./filters-sidebar";

// Approx height of the sticky nav (py-3.5 + content + 1px border).
// Drawer + backdrop start below this so the nav stays interactive.
const NAV_OFFSET = "64px";

export function FiltersDrawer({
  region,
  defaultServicesCount,
}: {
  region: Region;
  defaultServicesCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const params = useSearchParams();

  // Only render the portal once we're on the client (document.body exists).
  useEffect(() => {
    setMounted(true);
  }, []);

  // When `?services=` is in the URL it wins; when absent the server already
  // computed the cookie-fallback count and passed it down. Reading the cookie
  // here would mismatch SSR (no `document`) and trigger a hydration error.
  const servicesParam = params.get("services");
  const servicesCount =
    servicesParam === null
      ? defaultServicesCount
      : servicesParam.split(",").filter(Boolean).length;
  const activeCount =
    servicesCount + (params.get("ratings")?.split(",").filter(Boolean).length ?? 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close filters" : "Open filters"}
        aria-expanded={open}
        className="group inline-flex items-center gap-2 rounded-full bg-[color:var(--frosted)] px-3.5 py-2 text-[12px] font-medium text-white transition-colors hover:bg-[color:var(--frosted-strong)]"
        style={{ letterSpacing: "-0.01em", touchAction: "manipulation" }}
      >
        <Hamburger />
        <span>Filters</span>
        {activeCount > 0 && (
          <span
            className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
            style={{ backgroundColor: "var(--framer-blue)" }}
          >
            {activeCount}
          </span>
        )}
      </button>

      {mounted &&
        open &&
        createPortal(
          <>
            {/* Backdrop — sits below the nav so nav remains visible & clickable */}
            <div
              className="fixed inset-x-0 bottom-0 z-40 bg-black/80"
              style={{ top: NAV_OFFSET }}
              onClick={() => setOpen(false)}
              aria-hidden
            />
            {/* Drawer panel — portaled into <body> so the nav's
                backdrop-filter doesn't trap our fixed positioning. */}
            <aside
              className="drawer-slide-in fixed bottom-0 left-0 z-40 w-[280px] max-w-[74vw] overflow-y-auto border-r border-white/[0.06] bg-black p-5 shadow-2xl min-[430px]:w-[320px] min-[430px]:max-w-[88vw]"
              style={{ top: NAV_OFFSET }}
              role="dialog"
              aria-label="Filters"
            >
              <FiltersSidebar region={region} />
            </aside>
          </>,
          document.body,
        )}
    </>
  );
}

function Hamburger() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="pointer-events-none h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12" x2="14" y2="12" />
    </svg>
  );
}

