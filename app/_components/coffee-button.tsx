"use client";

import { track } from "@/lib/analytics";

export function CoffeeButton() {
  return (
    <a
      href="https://buymeacoffee.com/carsonmark"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Buy me a coffee"
      onClick={() => track("coffee_click")}
      className="inline-flex items-center gap-2 rounded-full bg-[color:var(--frosted)] py-1 pl-1 pr-1 text-[12px] font-medium text-white transition-colors hover:bg-[color:var(--frosted-strong)] sm:pr-3"
      style={{ letterSpacing: "-0.01em", touchAction: "manipulation" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/carson.jpeg"
        alt=""
        className="h-6 w-6 shrink-0 rounded-full object-cover"
      />
      <span className="hidden sm:inline">Buy me a coffee</span>
    </a>
  );
}
