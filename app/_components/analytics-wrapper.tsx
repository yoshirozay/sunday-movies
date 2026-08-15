"use client";

import { Analytics } from "@vercel/analytics/next";

// Wraps Vercel's Analytics so the same opt-out flag that silences our
// `track()` calls also silences Vercel's auto-collected page views. Without
// this, my own visits would still inflate page-view counts even with
// custom events disabled.
export function AnalyticsWrapper() {
  return (
    <Analytics
      beforeSend={(event) => {
        if (
          typeof window !== "undefined" &&
          window.localStorage.getItem("analytics-disabled") === "1"
        ) {
          return null;
        }
        return event;
      }}
    />
  );
}
