"use client";

import { useEffect } from "react";

// Side-channel for opting in/out of analytics. Visit any page with `?dev=1`
// to silence your own visits (sets a localStorage flag); `?dev=0` re-enables.
// Renders nothing.
export function AnalyticsConfig() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dev = params.get("dev");
    if (dev === "1") {
      window.localStorage.setItem("analytics-disabled", "1");
    } else if (dev === "0") {
      window.localStorage.removeItem("analytics-disabled");
    }
  }, []);
  return null;
}
