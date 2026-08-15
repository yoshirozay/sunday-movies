"use client";

import { track as vercelTrack } from "@vercel/analytics";

const DISABLED_KEY = "analytics-disabled";

// Skip our own tracking when the user has opted out (e.g. me testing).
// Set the flag by visiting any page with `?dev=1`; clear with `?dev=0`.
// See app/_components/analytics-config.tsx for the URL hook.
function isAnalyticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DISABLED_KEY) !== "1";
}

type EventProps = Record<string, string | number | boolean | null>;

export function track(event: string, properties?: EventProps): void {
  if (!isAnalyticsEnabled()) return;
  vercelTrack(event, properties);
}
