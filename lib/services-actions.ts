"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { StreamingService } from "./types";

const SERVICES_COOKIE = "services";
const ONBOARDED_COOKIE = "services-onboarded";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const VALID_SERVICES: ReadonlySet<StreamingService> = new Set<StreamingService>([
  "netflix",
  "prime",
  "hulu",
  "hbo",
  "paramount",
  "disney",
  "crave",
  "peacock",
  "apple",
]);

// Persist the user's service selection so the next visit's first server
// render already filters correctly — no client-side router.replace, no
// hero-image flash from re-rendering with a different filter.
export async function setServices(
  services: readonly StreamingService[],
): Promise<void> {
  const filtered = services.filter((s) => VALID_SERVICES.has(s));
  const store = await cookies();
  if (filtered.length === 0) {
    store.delete(SERVICES_COOKIE);
  } else {
    store.set(SERVICES_COOKIE, filtered.join(","), {
      maxAge: COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
    });
  }
  store.set(ONBOARDED_COOKIE, "1", {
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
