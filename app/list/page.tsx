import type { Metadata } from "next";
import Link from "next/link";
import { getRegion } from "@/lib/region";
import { CoffeeButton } from "@/app/_components/coffee-button";
import { RandomButton } from "@/app/_components/random-button";
import { SearchButton } from "@/app/_components/search-button";
import { WatchlistGrid } from "@/app/_components/watchlist-grid";

// Watchlist data lives entirely in localStorage on the client, so the page
// itself is dynamic but content-empty on the server. The grid hydrates and
// fills in the saved titles. No noindex — there's nothing to leak to crawlers
// (the page renders nothing for them).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My List",
  description: "Movies and TV you've saved to watch later.",
  robots: { index: false, follow: false },
};

export default async function WatchlistPage() {
  const region = await getRegion();

  return (
    <main>
      <div className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-black/40 backdrop-blur-md">
        <nav className="flex items-center justify-between px-3 py-3 sm:px-8 sm:py-3.5 lg:px-16">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-[12px] font-medium uppercase text-white/70 transition-colors hover:text-white"
            style={{ letterSpacing: "0.15em" }}
          >
            <span aria-hidden>←</span> sunday movies
          </Link>
          <div className="flex items-center gap-2">
            <RandomButton />
            <CoffeeButton />
            <SearchButton region={region} />
          </div>
        </nav>
      </div>

      <div className="mx-auto max-w-[1500px] px-6 pb-16 pt-24 lg:px-10">
        <header className="mb-8">
          <h1
            className="text-[40px] font-semibold leading-[1.0] text-white sm:text-[56px] lg:text-[64px]"
            style={{ letterSpacing: "-0.04em" }}
          >
            My List
          </h1>
        </header>
        <WatchlistGrid region={region} />
      </div>
    </main>
  );
}
