"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { REGIONS, type Region } from "./types";

// One year — long enough to feel sticky for users who pick a region once.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// Persist the user's region choice and trigger a re-render so the page
// reflects the new region's catalog and filters immediately.
export async function setRegion(region: Region): Promise<void> {
  if (!(REGIONS as string[]).includes(region)) {
    throw new Error(`Invalid region: ${region}`);
  }
  const cookieStore = await cookies();
  cookieStore.set("region", region, {
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
