// Mirror TMDB poster + backdrop images into Vercel Blob so the site stops
// depending on image.tmdb.org at runtime. After backfill, set
// NEXT_PUBLIC_IMAGE_CDN to the blob's public base URL — TMDB_IMG in
// lib/types.ts will swap automatically and components don't need to change.
//
// Why: image.tmdb.org going away (TMDB shuts down, blocks our IP, or rate
// limits us) would break every poster on every page instantly. Mirror →
// our blob removes that runtime dependency.
//
// Design notes:
//   - Streams TMDB → Blob (no disk involved). Memory usage is one chunk.
//   - Idempotent: lists existing blobs under `tmdb/` prefix at startup,
//     skips already-mirrored (size, path) tuples. Safe to re-run.
//   - Polite: bounded concurrency (8), 429 backoff, identifying User-Agent.
//   - Restartable: if the run crashes mid-way, re-running picks up where
//     it left off via the existing-blob check.
//   - Deterministic URLs: `addRandomSuffix: false` so our path-prefix-swap
//     trick in lib/types.ts works without any per-title URL lookups.
//
// Storage estimate: ~5500 unique titles × 7 sizes (4 poster + 3 backdrop)
// = ~38k images. ~4-5 GB total. Vercel Blob storage is ~$0.023/GB/mo.
//
// Usage:
//   node --env-file=.env.local scripts/mirror-images.mjs
//   node --env-file=.env.local scripts/mirror-images.mjs --region=au
//   node --env-file=.env.local scripts/mirror-images.mjs --dry-run

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { put, list } from "@vercel/blob";

const REGIONS = ["ca", "us", "gb", "au"];

// Sizes referenced in lib/types.ts (posterUrl + backdropUrl) — match exactly
// so the prefix-swap covers every variant the components request. Keep these
// in sync if those signatures change.
const POSTER_SIZES = ["w185", "w342", "w500", "w780"];
const BACKDROP_SIZES = ["w780", "w1280", "original"];

const TMDB_BASE = "https://image.tmdb.org/t/p";
const CONCURRENCY = 8;
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1000;
const USER_AGENT =
  "sundaymovies (image mirror; +https://github.com/yoshirozay/sunday-movies)";

// ────────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────────

function parseArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(`--${name}=`.length) : null;
}
const REGION_FILTER = parseArg("region"); // e.g. "au" → only that region's catalog
const DRY_RUN = process.argv.includes("--dry-run");

if (REGION_FILTER && !REGIONS.includes(REGION_FILTER)) {
  console.error(`Invalid --region: ${REGION_FILTER}. Use one of: ${REGIONS.join(", ")}.`);
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN not set. Did you run via --env-file=.env.local?");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ────────────────────────────────────────────────────────────────────────
// Phase 1: gather unique (size, path) tuples across all regions
// ────────────────────────────────────────────────────────────────────────

async function gatherTargets() {
  const regions = REGION_FILTER ? [REGION_FILTER] : REGIONS;
  const seen = new Set();
  const targets = [];
  let totalTitles = 0;

  for (const region of regions) {
    const file = path.join(process.cwd(), "public", `movies-${region}.json`);
    if (!existsSync(file)) {
      console.log(`  ${region}: file not found, skipping`);
      continue;
    }
    const movies = JSON.parse(await readFile(file, "utf8"));
    totalTitles += movies.length;
    for (const m of movies) {
      if (m.posterPath) {
        for (const size of POSTER_SIZES) {
          const key = `tmdb/${size}${m.posterPath}`;
          if (!seen.has(key)) {
            seen.add(key);
            targets.push({ key, size, srcPath: m.posterPath, kind: "poster" });
          }
        }
      }
      if (m.backdropPath) {
        for (const size of BACKDROP_SIZES) {
          const key = `tmdb/${size}${m.backdropPath}`;
          if (!seen.has(key)) {
            seen.add(key);
            targets.push({ key, size, srcPath: m.backdropPath, kind: "backdrop" });
          }
        }
      }
    }
    console.log(`  ${region}: ${movies.length} titles`);
  }
  return { targets, totalTitles };
}

// ────────────────────────────────────────────────────────────────────────
// Phase 2: list existing blobs to skip what's already mirrored
// ────────────────────────────────────────────────────────────────────────

async function listExisting() {
  const existing = new Set();
  let cursor;
  do {
    const result = await list({ prefix: "tmdb/", cursor, limit: 1000 });
    for (const blob of result.blobs) existing.add(blob.pathname);
    cursor = result.cursor;
  } while (cursor);
  return existing;
}

// ────────────────────────────────────────────────────────────────────────
// Phase 3: stream TMDB → Blob, with retries on 429 / network errors
// ────────────────────────────────────────────────────────────────────────

async function mirrorOne(target) {
  const tmdbUrl = `${TMDB_BASE}/${target.size}${target.srcPath}`;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(tmdbUrl, { headers: { "User-Agent": USER_AGENT } });
      if (res.status === 404) return { status: "404", target };
      if (res.status === 429) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      if (!res.ok) return { status: `http-${res.status}`, target };
      await put(target.key, res.body, {
        access: "public",
        contentType: res.headers.get("content-type") ?? "image/jpeg",
        addRandomSuffix: false,
      });
      return { status: "ok", target };
    } catch (e) {
      if (attempt === MAX_RETRIES) {
        return { status: "error", target, error: e.message };
      }
      await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    }
  }
  return { status: "exhausted", target };
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  console.log(
    `Mirror images → Vercel Blob${REGION_FILTER ? ` (region=${REGION_FILTER})` : ""}${DRY_RUN ? " [DRY RUN]" : ""}`,
  );

  console.log("\nPhase 1: gather targets from catalogs...");
  const { targets, totalTitles } = await gatherTargets();
  console.log(`  → ${targets.length} unique (size, path) tuples from ${totalTitles} titles`);

  console.log("\nPhase 2: list existing blobs...");
  const existing = await listExisting();
  console.log(`  → ${existing.size} blobs already in storage`);

  const todo = targets.filter((t) => !existing.has(t.key));
  const skip = targets.length - todo.length;
  console.log(`\nPhase 3: ${todo.length} to upload (${skip} already mirrored)`);

  if (todo.length === 0) {
    console.log("Nothing to do.");
    return;
  }
  if (DRY_RUN) {
    console.log("Dry run — sample of first 10 to-upload targets:");
    todo.slice(0, 10).forEach((t) => console.log(`  ${t.key}`));
    return;
  }

  // Bounded concurrency worker pool.
  let done = 0, ok = 0, missing404 = 0, errors = 0;
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const i = cursor++;
      const r = await mirrorOne(todo[i]);
      if (r.status === "ok") ok++;
      else if (r.status === "404") missing404++;
      else { errors++; failures.push(r); }
      done++;
      if (done % 50 === 0 || done === todo.length) {
        process.stdout.write(
          `  ${done}/${todo.length}  ok=${ok}  404=${missing404}  err=${errors}\r`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n\nDone in ${elapsedSec}s.  ok=${ok}, 404=${missing404}, errors=${errors}`);

  if (failures.length > 0) {
    const failPath = path.join(process.cwd(), `mirror-failures.json`);
    await writeFile(failPath, JSON.stringify(failures, null, 2));
    console.log(`\n${failures.length} failures written to ${failPath} — re-run script to retry.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
