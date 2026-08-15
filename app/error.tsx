"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Surface the error in the browser console so dev/prod logs catch it.
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
      <span
        className="text-[11px] font-medium uppercase text-[color:var(--silver)]"
        style={{ letterSpacing: "0.18em" }}
      >
        Something went wrong
      </span>
      <h1
        className="mt-3 max-w-xl text-[44px] font-semibold leading-[1.0] text-white sm:text-[64px]"
        style={{ letterSpacing: "-0.04em" }}
      >
        We couldn&rsquo;t load this page.
      </h1>
      <p
        className="mt-4 max-w-md text-[14px] leading-[1.5] text-[color:var(--silver)]"
        style={{ letterSpacing: "-0.01em" }}
      >
        It&rsquo;s probably nothing. Try again, or head back to the home page.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-black transition hover:bg-white/90"
          style={{ letterSpacing: "-0.01em" }}
        >
          Try again
        </button>
        <a
          href="/"
          className="inline-flex items-center gap-2 rounded-full bg-[color:var(--frosted)] px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-[color:var(--frosted-strong)]"
          style={{ letterSpacing: "-0.01em" }}
        >
          Back to home
        </a>
      </div>
      {error.digest && (
        <p className="mt-8 font-mono text-[10px] text-white/30">
          ref: {error.digest}
        </p>
      )}
    </main>
  );
}
