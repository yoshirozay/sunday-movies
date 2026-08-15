import { cookies, headers } from "next/headers";
import { REGIONS, type Region } from "./types";

const REGION_COOKIE = "region";
const DEFAULT_REGION: Region = "ca";

// Read the active region for this request. Cookie wins (user explicit choice),
// then Vercel's geo header (auto-detected country), then DEFAULT_REGION.
//
// Using cookies/headers opts the route into dynamic rendering — pages that
// call this can't be statically cached. Acceptable for now; revisit caching
// strategy as we scale to more regions.
export async function getRegion(): Promise<Region> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(REGION_COOKIE)?.value;
  if (isRegion(fromCookie)) return fromCookie;

  const headersList = await headers();
  const country = headersList.get("x-vercel-ip-country")?.toLowerCase();
  if (isRegion(country)) return country;

  return DEFAULT_REGION;
}

function isRegion(value: string | undefined): value is Region {
  return value !== undefined && (REGIONS as string[]).includes(value);
}
