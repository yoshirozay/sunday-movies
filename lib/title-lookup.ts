import { readFile } from "node:fs/promises";
import path from "node:path";
import { REGIONS, type Movie, type Region } from "./types";

async function loadCatalog(region: Region): Promise<Movie[]> {
  const file = path.join(process.cwd(), "public", `movies-${region}.json`);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as Movie[];
  } catch {
    return [];
  }
}

// Look the title up in the visitor's region first; fall back to scanning
// other regions so a shared link still resolves to *something* (we surface
// "not in your region" messaging instead of a hard 404).
export async function findTitle(
  tconst: string,
  region: Region,
): Promise<{ movie: Movie; foundIn: Region } | null> {
  const here = await loadCatalog(region);
  const local = here.find((m) => m.id === tconst);
  if (local) return { movie: local, foundIn: region };
  for (const r of REGIONS) {
    if (r === region) continue;
    const list = await loadCatalog(r);
    const hit = list.find((m) => m.id === tconst);
    if (hit) return { movie: hit, foundIn: r };
  }
  return null;
}
