// Cache hygiene for the automated catalog refresh. Run before fetch-data.mjs
// so each scheduled refresh re-validates a slice of cached data.
//
// What it does:
//   - Deletes JustWatch cache files (`.data-cache/justwatch-{region}/`) older
//     than CACHE_TTL_DAYS. Catches titles whose deep links rotted or whose
//     streaming home moved.
//   - Deletes TMDB watch-providers cache files (`.data-cache/watch-{region}{,-tv}/`)
//     older than CACHE_TTL_DAYS. Catches service moves (Netflix → HBO etc.).
//   - Always deletes the IMDb TSV downloads so we get daily-fresh data.
//
// Cert + TMDB-base caches are left alone — they're effectively static.
//
// Usage:
//   node scripts/prune-jw-cache.mjs                       # all regions
//   node scripts/prune-jw-cache.mjs --region=ca           # one region
//   node scripts/prune-jw-cache.mjs --dry-run             # report only
//   CACHE_TTL_DAYS=60 node scripts/prune-jw-cache.mjs     # widen TTL

import { readdir, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".data-cache");
const TTL_DAYS = parseInt(process.env.CACHE_TTL_DAYS ?? "30", 10);
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;
const DRY_RUN = process.argv.includes("--dry-run");

function parseRegionFlag() {
  const arg = process.argv.find((a) => a.startsWith("--region="));
  if (!arg) return null;
  const r = arg.slice("--region=".length);
  if (!["ca", "us", "gb", "au"].includes(r)) {
    console.error(`Invalid --region: ${r}`);
    process.exit(1);
  }
  return r;
}

async function pruneDir(dir, cutoff) {
  if (!existsSync(dir)) return { deleted: 0, kept: 0 };
  const entries = await readdir(dir);
  let deleted = 0;
  let kept = 0;
  for (const name of entries) {
    const file = path.join(dir, name);
    const s = await stat(file);
    if (s.mtimeMs < cutoff) {
      if (!DRY_RUN) await unlink(file);
      deleted++;
    } else {
      kept++;
    }
  }
  return { deleted, kept };
}

async function deleteFile(file) {
  if (!existsSync(file)) return false;
  if (!DRY_RUN) await unlink(file);
  return true;
}

async function main() {
  const onlyRegion = parseRegionFlag();
  const regions = onlyRegion ? [onlyRegion] : ["ca", "us", "gb", "au"];
  const cutoff = Date.now() - TTL_MS;

  console.log(
    `${DRY_RUN ? "[DRY RUN] " : ""}Pruning cache entries older than ${TTL_DAYS} days...`,
  );

  for (const region of regions) {
    const jwDir = path.join(CACHE_DIR, `justwatch-${region}`);
    const watchMovieDir = path.join(CACHE_DIR, `watch-${region}`);
    const watchTvDir = path.join(CACHE_DIR, `watch-${region}-tv`);

    const jw = await pruneDir(jwDir, cutoff);
    const wm = await pruneDir(watchMovieDir, cutoff);
    const wt = await pruneDir(watchTvDir, cutoff);

    console.log(
      `  ${region}: justwatch ${jw.deleted}/${jw.deleted + jw.kept}, watch-movie ${wm.deleted}/${wm.deleted + wm.kept}, watch-tv ${wt.deleted}/${wt.deleted + wt.kept}`,
    );
  }

  // IMDb TSVs aren't per-region — drop them unconditionally so the next
  // fetch downloads today's data.
  const basics = path.join(CACHE_DIR, "title.basics.tsv.gz");
  const ratings = path.join(CACHE_DIR, "title.ratings.tsv.gz");
  const basicsDeleted = await deleteFile(basics);
  const ratingsDeleted = await deleteFile(ratings);
  if (basicsDeleted || ratingsDeleted) {
    console.log(
      `  imdb: removed ${[basicsDeleted && "basics", ratingsDeleted && "ratings"].filter(Boolean).join(" + ")}`,
    );
  }
}

await main();
