"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Horizontally scrollable row with unobtrusive left/right arrow buttons for
 * users who don't have a trackpad. Arrows fade in/out based on whether the
 * row can scroll further in that direction.
 */
export function ScrollableRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft = 0;

    // Trackpad vertical gestures often have a small horizontal component
    // that drifts overflow-x rows as the user scrolls past. Treat scrolls
    // as "intentional" only when the gesture is primarily horizontal — any
    // scroll change before that is rejected and snapped back to 0.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        userScrolledRef.current = true;
      }
    };

    let touchStartX = 0;
    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      touchStartX = t.clientX;
      touchStartY = t.clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const dx = Math.abs(t.clientX - touchStartX);
      const dy = Math.abs(t.clientY - touchStartY);
      if (dx > 10 && dx > dy) {
        userScrolledRef.current = true;
      }
    };

    const update = () => {
      if (!userScrolledRef.current && el.scrollLeft !== 0) {
        el.scrollLeft = 0;
        return;
      }
      // Small fudge factor for sub-pixel rounding
      setCanLeft(el.scrollLeft > 4);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("resize", update);
    };
  }, []);

  const scrollByPage = (dir: 1 | -1) => {
    userScrolledRef.current = true;
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <div className="group relative">
      <div
        ref={ref}
        className="flex gap-3 overflow-x-auto px-8 pb-4 lg:px-16 snap-x scroll-px-8 lg:scroll-px-16 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {children}
      </div>

      {canLeft && (
        <button
          onClick={() => scrollByPage(-1)}
          aria-label="Scroll left"
          className="absolute left-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:scale-105 sm:flex lg:left-4"
          style={{
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            boxShadow: "rgba(0, 0, 0, 0.6) 0px 0px 0px 1px",
          }}
        >
          <Chevron direction="left" />
        </button>
      )}

      {canRight && (
        <button
          onClick={() => scrollByPage(1)}
          aria-label="Scroll right"
          className="absolute right-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:scale-105 sm:flex lg:right-4"
          style={{
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            boxShadow: "rgba(0, 0, 0, 0.6) 0px 0px 0px 1px",
          }}
        >
          <Chevron direction="right" />
        </button>
      )}
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
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
  );
}
