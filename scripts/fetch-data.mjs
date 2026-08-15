// Downloads IMDb's public non-commercial datasets, filters them, and enriches
// the survivors with poster/backdrop/overview data from TMDB. Handles BOTH
// movies and TV shows (each kind has different rating thresholds and uses
// different TMDB endpoints).
//
// Source: https://datasets.imdbws.com/  (license: non-commercial use)
// Enrichment: https://developer.themoviedb.org/  (requires TMDB_API_KEY in .env.local)

import { createWriteStream, createReadStream, existsSync } from "node:fs";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".data-cache");
const TMDB_CACHE_DIR = path.join(CACHE_DIR, "tmdb");
const PUBLIC_DIR = path.join(process.cwd(), "public");
const BASICS_URL = "https://datasets.imdbws.com/title.basics.tsv.gz";
const RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";

// Inclusion criteria — TV is held to a higher quality bar than movies because
// the long-tail of mediocre TV is huge.
const MIN_RATING_MOVIE = 7.0;
const MIN_RATING_TV = 8.0;
const MIN_VOTES = 25000;

const TMDB_API_KEY = process.env.TMDB_API_KEY;
// 20 is fine when the local TMDB cache is already warm (most calls are
// cache hits). For cold runs (e.g. fresh CI), 3000+ simultaneous requests
// trip TMDB's rate limiter — set TMDB_CONCURRENCY=2 in that case.
const TMDB_CONCURRENCY = parseInt(process.env.TMDB_CONCURRENCY ?? "20", 10);

// CLI: --region=ca|us|gb|au, a comma list (ca,us), or `all`. Default ca for
// backward compat with the existing `npm run fetch-data` workflow. Multiple
// regions run in one process: the IMDb parse and the region-independent TMDB
// metadata/cert stages happen once, then each region runs its
// availability → deny → deep-link → reconcile → write stages.
const ALL_REGIONS = ["ca", "us", "gb", "au"];
function parseRegions() {
  const arg = process.argv.find((a) => a.startsWith("--region="));
  const raw = arg ? arg.slice("--region=".length) : "ca";
  const list = raw === "all" ? [...ALL_REGIONS] : raw.split(",");
  for (const r of list) {
    if (!ALL_REGIONS.includes(r)) {
      console.error(
        `Invalid --region: ${r}. Use ca, us, gb, au, a comma list, or all.`,
      );
      process.exit(1);
    }
  }
  return list;
}
const REGIONS_TO_RUN = parseRegions();

// Region-scoped state, re-pointed by initRegion() before each region's
// pipeline stages. Everything above the availability stage is
// region-independent and must not read these.
let REGION;
let COUNTRY;
let REGION_LABEL;
let SERVICES;
let WATCH_CACHE_DIR;
let JW_CACHE_DIR;
let JW_PACKAGE_TO_SERVICE;
let OUTPUT_FILENAME;

function initRegion(region) {
  REGION = region;
  COUNTRY = region.toUpperCase();
  REGION_LABEL =
    region === "us"
      ? "US"
      : region === "gb"
        ? "UK"
        : region === "au"
          ? "Australian"
          : "Canadian";
  SERVICES = SERVICES_BY_REGION[region];
  WATCH_CACHE_DIR = {
    movie: path.join(CACHE_DIR, `watch-${region}`),
    tv: path.join(CACHE_DIR, `watch-${region}-tv`),
  };
  JW_CACHE_DIR = path.join(CACHE_DIR, `justwatch-${region}`);
  JW_PACKAGE_TO_SERVICE = JW_PACKAGES_BY_REGION[region];
  OUTPUT_FILENAME = `movies-${region}.json`;
  // Per-region JW cache dirs mean "fetched this run" is per-region too.
  JW_FETCHED_THIS_RUN.clear();
}

// Streaming services we care about, per region. Each service maps to the set
// of TMDB provider IDs that count as "this service" (includes ad-supported
// tiers but excludes channel-bundle aggregators where you'd watch the
// content via another platform's UI).
const SERVICES_BY_REGION = {
  ca: {
    netflix: new Set([8, 175, 1796]),
    prime: new Set([119, 2100]),
    disney: new Set([337]),
    crave: new Set([230, 2604]),
    apple: new Set([350]), // Apple TV+ — excludes 'Apple TV Store' (rentals)
  },
  us: {
    netflix: new Set([8, 175, 1796]),
    prime: new Set([9, 2100]), // US Prime is 9 (CA is 119)
    hulu: new Set([15]),
    hbo: new Set([1899]), // "HBO Max" / Max — excludes Amazon Channel bundle
    paramount: new Set([2303, 2616]), // Premium + Essential (ads)
    disney: new Set([337]),
    peacock: new Set([386, 387]), // Premium + Premium Plus
    apple: new Set([350]),
  },
  // UK provider IDs verified via scripts/probe-gb-providers.mjs against
  // ground-truth titles. Excludes "Amazon Channel" / "Apple TV Channel"
  // sub-rental ids (1825, 582, 1853, 2243) — those route to amazon.co.uk
  // paywalls, not the actual service. Now TV combines `39` (Entertainment,
  // covers HBO TV like Last of Us / House of the Dragon) and `591` (Cinema,
  // covers movies); both flow into our single `now` service.
  gb: {
    netflix: new Set([8, 1796]),
    prime: new Set([9, 2100]),
    disney: new Set([337]),
    paramount: new Set([531, 2303, 2304]),
    now: new Set([39, 591]),
    apple: new Set([350]),
  },
  // AU provider IDs verified via scripts/probe-au-providers.mjs against
  // ground-truth titles. Notes:
  //   - AU Prime is `119` (CA is also 119; US/GB are 9). 2100 is the
  //     ad-supported variant.
  //   - Excludes Amazon/Apple Channel sub-rental ids (582, 1825, 1853, 2243)
  //     — those route to amazon.com.au paywalls, not the actual service.
  //   - `binge` (id 385) intentionally excluded: TMDB/JustWatch no longer
  //     surface it for HBO content; HBO Max launched direct in AU and
  //     replaced Binge as the primary HBO carrier. Foxtel Now (id 134)
  //     also excluded — niche service, HBO Max covers the same catalog.
  au: {
    netflix: new Set([8, 1796]),
    prime: new Set([119, 2100]),
    disney: new Set([337]),
    paramount: new Set([531, 2303, 2304]),
    stan: new Set([21]),
    hbomax: new Set([1899]),
    apple: new Set([350]),
  },
};

// Per-kind cache dirs because TMDB IDs are namespaced separately for movies
// vs. TV (movie 100 ≠ TV show 100). Tconst-keyed caches (TMDB find, JustWatch)
// can be shared since IMDb tconsts are globally unique. Watch/JW dirs are
// region-scoped — see initRegion().
const CERT_CACHE_DIR = {
  movie: path.join(CACHE_DIR, "cert-us"),
  tv: path.join(CACHE_DIR, "cert-us-tv"),
};

const VALID_CERTS = new Set(["G", "PG", "PG-13", "R", "NC-17"]);

// Map US TV ratings to MPAA equivalents so the filter UI works for both kinds.
const TV_TO_MPAA = {
  "TV-Y": "G",
  "TV-Y7": "G",
  "TV-G": "G",
  "TV-PG": "PG",
  "TV-14": "PG-13",
  "TV-MA": "R",
};

// JustWatch package.technicalName → our internal service key. Per-region
// because the same service can have different technicalNames across markets
// (e.g. CA Prime is `amazonprimevideo`, US is `amazonprime`) and ad-tier
// variants need to map back to the same service.
const JW_PACKAGES_BY_REGION = {
  ca: {
    netflix: "netflix",
    amazonprimevideo: "prime",
    disneyplus: "disney",
    crave: "crave",
    appletvplus: "apple",
  },
  us: {
    netflix: "netflix",
    netflixbasicwithads: "netflix",
    amazonprime: "prime",
    amazonprimevideowithads: "prime",
    hulu: "hulu",
    max: "hbo",
    paramountpluspremium: "paramount",
    paramountplusessential: "paramount",
    disneyplus: "disney",
    peacocktv: "peacock",
    peacocktvpremium: "peacock",
    appletvplus: "apple",
  },
  // UK packages verified via scripts/probe-gb-providers.mjs. Note that UK
  // Prime uses the `amazonprime` technicalName (matches US), NOT the CA-style
  // `amazonprimevideo`. Excludes Amazon/Apple Channel packages whose URLs
  // point to amazon.co.uk paywalls (`amazonhbomax`, `amazonparamountplus`,
  // `appletvparamountplus`, `amazonappletvplus`).
  gb: {
    netflix: "netflix",
    netflixbasicwithads: "netflix",
    amazonprime: "prime",
    amazonprimevideowithads: "prime",
    disneyplus: "disney",
    paramountplus: "paramount",
    paramountpluspremium: "paramount",
    paramountplusbasicwithads: "paramount",
    nowtv: "now",
    nowtvcinema: "now",
    appletvplus: "apple",
  },
  // AU packages verified via scripts/probe-au-providers.mjs. Note that AU
  // Prime uses the `amazonprimevideo` technicalName (matches CA), NOT the
  // US/GB `amazonprime`. Excludes Amazon/Apple Channel packages whose URLs
  // point to other-platform paywalls (`amazonhbomax`, `amazonparamountplus`,
  // `appletvparamountplus`, `amazonappletvplus`) and `foxtelplay` (Foxtel
  // Now is out of scope — HBO Max covers the same content).
  au: {
    netflix: "netflix",
    netflixbasicwithads: "netflix",
    amazonprimevideo: "prime",
    amazonprimevideowithads: "prime",
    disneyplus: "disney",
    paramountplus: "paramount",
    paramountpluspremium: "paramount",
    paramountplusbasicwithads: "paramount",
    stan: "stan",
    max: "hbomax",
    appletvplus: "apple",
  },
};
const JW_ENDPOINT = "https://apis.justwatch.com/graphql";
const JW_QUERY = `query Search($country: Country!, $language: Language!, $first: Int!, $f: TitleFilter) {
  popularTitles(country: $country, first: $first, filter: $f) {
    edges { node {
      objectType
      content(country: $country, language: $language) { title originalReleaseYear }
      offers(country: $country, platform: WEB) { monetizationType standardWebURL package { technicalName } }
    } }
  }
}`;

async function download(url, dest) {
  if (existsSync(dest)) {
    console.log(`✓ Cached: ${path.basename(dest)}`);
    return;
  }
  console.log(`↓ Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed (${res.status}): ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`✓ Saved: ${path.basename(dest)}`);
}

async function* readTsv(gzPath) {
  const stream = createReadStream(gzPath).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    const cols = line.split("\t");
    if (!header) {
      header = cols;
      continue;
    }
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = cols[i] === "\\N" ? null : cols[i];
    }
    yield obj;
  }
}

// ---------- TMDB fetch with 429 retry ----------

// TMDB occasionally returns 429 when many concurrent requests are made (cold
// caches in CI hit this hard). Retry with exponential backoff, honoring the
// Retry-After header when present. All TMDB callers go through this helper.
async function fetchTmdb(url, maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status !== 429) return res;
      if (attempt === maxRetries) return res;
      const ra = res.headers.get("retry-after");
      const baseMs = ra ? parseInt(ra, 10) * 1000 : 1000 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, Math.min(baseMs + jitter, 30000)));
    } catch (e) {
      if (attempt === maxRetries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  return null;
}

// ---------- TMDB find (works for both movies and TV) ----------

async function fetchTmdbOne(imdbId, kind) {
  const cacheFile = path.join(TMDB_CACHE_DIR, `${imdbId}.json`);
  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf8"));
      // Cache version check: only honor if it has the new originalLanguage
      // field. Older entries fall through to a refetch (one-time backfill).
      if ("originalLanguage" in cached) return cached;
    } catch {
      /* fall through */
    }
  }
  const url = `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&api_key=${TMDB_API_KEY}`;
  try {
    const res = await fetchTmdb(url);
    if (!res || !res.ok) return null;
    const data = await res.json();
    const match =
      kind === "tv" ? data.tv_results?.[0] : data.movie_results?.[0];
    const enrichment = match
      ? {
          tmdbId: match.id,
          posterPath: match.poster_path ?? null,
          backdropPath: match.backdrop_path ?? null,
          overview: match.overview ?? null,
          originalLanguage: match.original_language ?? null,
        }
      : {
          tmdbId: null,
          posterPath: null,
          backdropPath: null,
          overview: null,
          originalLanguage: null,
        };
    await writeFile(cacheFile, JSON.stringify(enrichment));
    return enrichment;
  } catch {
    return null;
  }
}

async function enrichWithTmdb(titles) {
  if (!TMDB_API_KEY) {
    console.log("⚠ TMDB_API_KEY not set — skipping poster enrichment");
    return titles;
  }
  await mkdir(TMDB_CACHE_DIR, { recursive: true });
  console.log(`Enriching ${titles.length} titles from TMDB...`);

  let done = 0;
  let hits = 0;
  const results = new Array(titles.length);
  let cursor = 0;
  async function worker() {
    while (cursor < titles.length) {
      const i = cursor++;
      const m = titles[i];
      const enrichment = await fetchTmdbOne(m.id, m.kind);
      if (enrichment?.posterPath) hits++;
      results[i] = enrichment ? { ...m, ...enrichment } : m;
      done++;
      if (done % 100 === 0) {
        process.stdout.write(
          `  ${done}/${titles.length} (${hits} with posters)\r`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: TMDB_CONCURRENCY }, () => worker()));
  console.log(`  ${done}/${titles.length} (${hits} with posters) ✓`);
  return results;
}

// ---------- Watch providers (per-kind endpoint) ----------

// Thrown for errors that invalidate the whole run (e.g. a revoked API key).
// Aborting beats silently carrying the entire previous catalog forward and
// publishing a 100% stale file with exit code 0.
class FatalApiError extends Error {}

async function fetchWatchProviders(tmdbId, kind) {
  const cacheFile = path.join(WATCH_CACHE_DIR[kind], `${tmdbId}.json`);
  if (existsSync(cacheFile)) {
    try {
      return JSON.parse(await readFile(cacheFile, "utf8"));
    } catch {
      /* fall through */
    }
  }
  const endpoint = kind === "tv" ? "tv" : "movie";
  const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`;
  try {
    const res = await fetchTmdb(url);
    if (res && res.status === 401) {
      throw new FatalApiError(
        "TMDB returned 401 — check TMDB_API_KEY. Aborting so a misconfigured key can't publish a stale catalog.",
      );
    }
    // A 404 is authoritative: this TMDB id is gone (deleted/merged), not a
    // transient failure. Cache the empty result so the title doesn't loop
    // through retry + carry-forward on every refresh, masking removal
    // forever.
    if (res && res.status === 404) {
      const result = { availableOn: [] };
      await writeFile(cacheFile, JSON.stringify(result));
      return result;
    }
    if (!res || !res.ok) return null;
    const data = await res.json();
    const flatrate = data.results?.[COUNTRY]?.flatrate ?? [];
    const ids = flatrate.map((p) => p.provider_id);
    const services = [];
    for (const [key, set] of Object.entries(SERVICES)) {
      if (ids.some((id) => set.has(id))) services.push(key);
    }
    const result = { availableOn: services };
    await writeFile(cacheFile, JSON.stringify(result));
    return result;
  } catch (e) {
    if (e instanceof FatalApiError) throw e;
    return null;
  }
}

async function enrichWithWatchProviders(titles) {
  if (!TMDB_API_KEY) return titles;
  await mkdir(WATCH_CACHE_DIR.movie, { recursive: true });
  await mkdir(WATCH_CACHE_DIR.tv, { recursive: true });
  console.log(
    `Checking ${REGION_LABEL} availability for ${titles.length} titles...`,
  );

  const targets = titles.filter((m) => m.tmdbId);
  let done = 0;
  let hits = 0;
  const byId = new Map();
  const failed = [];
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const i = cursor++;
      const m = targets[i];
      const w = await fetchWatchProviders(m.tmdbId, m.kind);
      if (w === null) failed.push(m);
      if (w?.availableOn?.length) hits++;
      byId.set(m.id, w?.availableOn ?? []);
      done++;
      if (done % 100 === 0) {
        process.stdout.write(
          `  ${done}/${targets.length} (${hits} streaming in ${COUNTRY})\r`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: TMDB_CONCURRENCY }, () => worker()));
  console.log(`  ${done}/${targets.length} (${hits} streaming in ${COUNTRY}) ✓`);

  // A transient TMDB failure reads as "not streaming" and would silently
  // drop the title until the next refresh (this falsely removed ~10 titles
  // across US/GB/AU on 2026-06-09 — Mosul, Robin Hood, Utopia, et al., all
  // listed as "Removed" in that refresh report). Failures aren't cached, so:
  // retry once, then carry forward the previous catalog's availability for
  // anything still failing. Carried-forward titles aren't cached either, so
  // the next run re-checks them.
  if (failed.length > 0) {
    console.log(`  retrying ${failed.length} failed availability fetch(es)...`);
    const still = [];
    for (const m of failed) {
      const w = await fetchWatchProviders(m.tmdbId, m.kind);
      if (w === null) still.push(m);
      else {
        if (w.availableOn?.length) hits++;
        byId.set(m.id, w.availableOn ?? []);
      }
    }
    if (still.length > 0) {
      let prev = new Map();
      const prevPath = path.join(PUBLIC_DIR, OUTPUT_FILENAME);
      if (existsSync(prevPath)) {
        try {
          prev = new Map(
            JSON.parse(await readFile(prevPath, "utf8")).map((t) => [
              t.id,
              t.availableOn ?? [],
            ]),
          );
        } catch {
          /* unreadable previous catalog — fall through to dropping */
        }
      }
      let carried = 0;
      for (const m of still) {
        const p = prev.get(m.id);
        if (p && p.length > 0) {
          byId.set(m.id, p);
          carried++;
        }
      }
      console.log(
        `  ⚠ ${still.length} availability fetch(es) failed twice — carried forward previous availability for ${carried} title(s)`,
      );
      // Carry-forward is a patch for scattered transient failures, not a
      // license to republish a stale catalog. A high failure rate means
      // something systemic (TMDB outage, network) — abort rather than
      // publish data we mostly didn't verify.
      const cap = Math.max(25, Math.ceil(targets.length * 0.01));
      if (still.length > cap) {
        throw new FatalApiError(
          `${still.length} availability fetches failed twice (cap ${cap}) — TMDB is likely down. Aborting instead of publishing a mostly carried-forward catalog.`,
        );
      }
    }
  }

  return titles.map((m) => ({ ...m, availableOn: byId.get(m.id) ?? [] }));
}

// ---------- Availability deny-list ----------

// Read deny-{region}.json (if present) and strip suppressed services from
// each title's availableOn. Counterpart to manual-links-{region}.json: TMDB
// and JustWatch sometimes both report FLATRATE for a title that's actually
// rent/buy-only (the "false-flatrate Prime" class — see REFRESH-ca.md), and
// no automated signal can detect it. Entries here survive refreshes, so a
// verified one-off drop isn't reintroduced by the next availability
// re-fetch. Shape: { "tt1234567": ["prime", ...] }
async function applyDenyList(titles) {
  const denyPath = path.join(process.cwd(), `deny-${REGION}.json`);
  if (!existsSync(denyPath)) return titles;
  let deny;
  try {
    deny = JSON.parse(await readFile(denyPath, "utf8"));
  } catch (e) {
    console.error(`⚠ Failed to parse ${denyPath}: ${e.message}`);
    return titles;
  }
  let suppressed = 0;
  const out = titles.map((m) => {
    const services = deny[m.id];
    if (!Array.isArray(services) || !m.availableOn) return m;
    const filtered = m.availableOn.filter((s) => !services.includes(s));
    if (filtered.length === m.availableOn.length) return m;
    suppressed++;
    return { ...m, availableOn: filtered };
  });
  if (suppressed > 0) {
    console.log(
      `Deny-list: suppressed ${suppressed} false attribution(s) from deny-${REGION}.json`,
    );
  }
  return out;
}

// ---------- US certifications (per-kind endpoint, normalized to MPAA) ----------

async function fetchUsCert(tmdbId, kind) {
  const cacheFile = path.join(CERT_CACHE_DIR[kind], `${tmdbId}.json`);
  if (existsSync(cacheFile)) {
    try {
      return JSON.parse(await readFile(cacheFile, "utf8"));
    } catch {
      /* fall through */
    }
  }

  if (kind === "tv") {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}/content_ratings?api_key=${TMDB_API_KEY}`;
    try {
      const res = await fetchTmdb(url);
      if (!res || !res.ok) return null;
      const data = await res.json();
      const us = data.results?.find((r) => r.iso_3166_1 === "US");
      const raw = (us?.rating ?? "").trim().toUpperCase().replace(/\s/g, "");
      const certification = TV_TO_MPAA[raw] ?? "NR";
      const result = { certification };
      await writeFile(cacheFile, JSON.stringify(result));
      return result;
    } catch {
      return null;
    }
  }

  const url = `https://api.themoviedb.org/3/movie/${tmdbId}/release_dates?api_key=${TMDB_API_KEY}`;
  try {
    const res = await fetchTmdb(url);
    if (!res || !res.ok) return null;
    const data = await res.json();
    const us = data.results?.find((r) => r.iso_3166_1 === "US");
    const certs = (us?.release_dates ?? [])
      .map((rd) => (rd.certification || "").trim().toUpperCase())
      .filter(Boolean);
    const theatrical = (us?.release_dates ?? []).find((rd) => rd.type === 3)
      ?.certification?.trim()
      ?.toUpperCase();
    const first = certs[0];
    const picked = [theatrical, first].find((c) => c && VALID_CERTS.has(c));
    const result = { certification: picked ?? "NR" };
    await writeFile(cacheFile, JSON.stringify(result));
    return result;
  } catch {
    return null;
  }
}

async function enrichWithCerts(titles) {
  if (!TMDB_API_KEY) return titles;
  await mkdir(CERT_CACHE_DIR.movie, { recursive: true });
  await mkdir(CERT_CACHE_DIR.tv, { recursive: true });
  console.log(`Fetching US certifications for ${titles.length} titles...`);
  const targets = titles.filter((m) => m.tmdbId);
  let done = 0;
  const byId = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const i = cursor++;
      const m = targets[i];
      const c = await fetchUsCert(m.tmdbId, m.kind);
      byId.set(m.id, c?.certification ?? "NR");
      done++;
      if (done % 100 === 0) {
        process.stdout.write(`  ${done}/${targets.length}\r`);
      }
    }
  }
  await Promise.all(Array.from({ length: TMDB_CONCURRENCY }, () => worker()));
  console.log(`  ${done}/${targets.length} ✓`);
  return titles.map((m) => ({ ...m, certification: byId.get(m.id) ?? "NR" }));
}

// ---------- JustWatch deep links (per-kind objectType filter) ----------

// Paramount+ uses country-coded TLDs outside the US. Video IDs are global, so
// only the host changes. JustWatch hands back the bare `paramountplus.com`
// host for AU/GB titles, which routes to the US catalog and 404s. Rewrite the
// host based on COUNTRY before we cache.
const PARAMOUNT_HOSTS = {
  US: "www.paramountplus.com",
  AU: "www.paramountplus.com.au",
  GB: "www.paramountplus.co.uk",
};

function rewriteParamountHost(url) {
  const target = PARAMOUNT_HOSTS[COUNTRY];
  if (!target) return url;
  return url.replace(
    /^https:\/\/www\.paramountplus\.(?:com\.au|co\.uk|com)\//,
    `https://${target}/`,
  );
}

// JustWatch returns deep links that don't always resolve cleanly: TV shows
// often deep-link to S1E1 (auto-launching the pilot), and Paramount+ movies
// use an invalid /movies/{slug}/{id} format that 404s. Rewrite to URLs that
// land users on the right page regardless of session state.
function normalizeDeeplink(url, service, kind) {
  if (kind === "tv") {
    if (service === "crave") {
      const x = url.match(
        /^https:\/\/www\.crave\.ca\/(en|fr)\/play\/([^/]+)\//,
      );
      if (x) return `https://www.crave.ca/${x[1]}/tv-shows/${x[2]}`;
    }
    if (service === "apple") {
      const sid = url.match(/[?&]showId=(umc\.cmc\.[a-z0-9]+)/i);
      const reg = url.match(/^https:\/\/tv\.apple\.com\/([a-z]{2})\/episode\//i);
      if (sid && reg) return `https://tv.apple.com/${reg[1]}/show/${sid[1]}`;
    }
    if (service === "peacock") {
      // peacocktv.com/watch/asset/tv/{slug}/{showId}/seasons/.../episodes/...
      // → strip everything from /seasons/ onward to land on the show page.
      return url.replace(
        /(\/watch\/asset\/tv\/[^/]+\/[^/]+)\/seasons\/.*$/,
        "$1",
      );
    }
    if (service === "paramount") {
      // paramountplus.com/shows/{slug}/video/{episodeId}/... → /shows/{slug}/
      const stripped = url.replace(/(\/shows\/[^/]+)\/video\/.*$/, "$1/");
      return rewriteParamountHost(stripped);
    }
    if (service === "now") {
      // nowtv.com/watch/{slug}/{showId}/seasons/X/episodes/Y/{epId}
      // → strip everything from /seasons/ onward to land on the show page.
      return url.replace(/(\/watch\/[^/]+\/[^/]+)\/seasons\/.*$/, "$1");
    }
    if (service === "hbomax") {
      // JW: hbomax.com/{region}/{lang}/shows/{slug}/s{n}/{UUID}
      // → /shows/{slug}/{UUID}.  AU show pages 404 without the trailing
      // UUID — despite the /s{n}/ middle segment, the last token is the
      // show id, not an episode id.
      return url.replace(/(\/shows\/[^/]+)\/s\d+\/([^/?#]+)/, "$1/$2");
    }
  }
  if (kind === "movie") {
    if (service === "paramount") {
      // JW: paramountplus.com/movies/{slug}/{id}?searchReferral=...&source=...
      // ↑ this path 404s. Canonical: paramountplus.com/movies/video/{id}/
      const m = url.match(
        /^https:\/\/www\.paramountplus\.(?:com\.au|co\.uk|com)\/movies\/[^/]+\/([^/?#]+)/,
      );
      const cleaned = m
        ? `https://www.paramountplus.com/movies/video/${m[1]}/`
        : url;
      return rewriteParamountHost(cleaned);
    }
  }
  return url;
}

// JustWatch wraps US Disney+ links in an affiliate redirect via
// disneyplus.bn5x.net. Unwrap to the raw disneyplus.com URL so users skip
// the redirect hop and the third-party tracker. The real URL lives in the
// `u=` query param, URL-encoded. Safe to call on any URL — no-op when the
// pattern doesn't match.
function unwrapDisneyAffiliate(url) {
  if (!url.startsWith("https://disneyplus.bn5x.net/")) return url;
  try {
    const u = new URL(url).searchParams.get("u");
    if (u) {
      const decoded = decodeURIComponent(u);
      if (decoded.startsWith("https://www.disneyplus.com/")) return decoded;
    }
  } catch {
    /* fall through */
  }
  return url;
}

async function fetchJustWatchLinks(tconst, title, year, kind, availableOn) {
  const cacheFile = path.join(JW_CACHE_DIR, `${tconst}.json`);
  if (existsSync(cacheFile)) {
    try {
      return JSON.parse(await readFile(cacheFile, "utf8"));
    } catch {
      /* fall through */
    }
  }
  const wantedType = kind === "tv" ? "SHOW" : "MOVIE";
  try {
    const res = await fetch(JW_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (sunday-movies; personal use; +https://github.com)",
      },
      body: JSON.stringify({
        operationName: "Search",
        variables: {
          country: COUNTRY,
          language: "en",
          first: 5,
          f: { searchQuery: title },
        },
        query: JW_QUERY,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // GraphQL gateways report rate-limiting/errors as 200 + an errors array.
    // Treat that as a failed fetch (uncached, counts toward the
    // consecutive-error stop) — caching it would record a permanent
    // "no links" answer for a title JustWatch never actually evaluated.
    if (Array.isArray(data?.errors) && data.errors.length > 0) return null;
    const edges = data?.data?.popularTitles?.edges ?? [];
    const candidates = edges.filter(
      (e) => e.node.objectType === wantedType,
    );
    const match =
      candidates.find((e) => {
        const y = e.node.content.originalReleaseYear;
        return year != null && y != null && Math.abs(y - year) <= 1;
      }) ?? candidates[0];
    const links = {};
    if (match) {
      for (const offer of match.node.offers ?? []) {
        if (offer.monetizationType !== "FLATRATE") continue;
        const tn = offer.package?.technicalName;
        const svc = tn ? JW_PACKAGE_TO_SERVICE[tn] : null;
        if (svc && offer.standardWebURL && !links[svc]) {
          let finalUrl = unwrapDisneyAffiliate(offer.standardWebURL);
          finalUrl = normalizeDeeplink(finalUrl, svc, kind);
          links[svc] = finalUrl;
        }
      }
    }
    // forAvailability records which services the title was on when this
    // entry was fetched. The reconcile pass uses it to re-fetch only titles
    // whose availability changed since — a title JustWatch genuinely has no
    // link for (e.g. Amazon-Channel-only Crave offers) is fetched once per
    // availability state, not once per refresh.
    const result = {
      streamingLinks: links,
      forAvailability: [...(availableOn ?? [])].sort(),
    };
    await writeFile(cacheFile, JSON.stringify(result));
    return result;
  } catch {
    return null;
  }
}

// JustWatch politeness settings. Sequential + several seconds of jitter per
// network call so we look like a human reading the site rather than a script
// hammering the API. Cache hits are instant (no sleep). Tunable via env vars
// so a future re-fetch can be even gentler if needed.
const JW_DELAY_MIN_MS = parseInt(process.env.JW_DELAY_MIN_MS ?? "4000", 10);
const JW_DELAY_MAX_MS = parseInt(process.env.JW_DELAY_MAX_MS ?? "7000", 10);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Tconsts that hit the JustWatch network (not cache) during the current
// region's pass (cleared by initRegion — JW caches are per-region). The
// reconcile pass uses this to avoid pointlessly re-fetching a title we just
// fetched seconds ago — and it guarantees the reconcile terminates.
const JW_FETCHED_THIS_RUN = new Set();

async function enrichWithJustWatch(titles, only = null) {
  await mkdir(JW_CACHE_DIR, { recursive: true });
  const targets = titles.filter(
    (m) =>
      m.availableOn &&
      m.availableOn.length > 0 &&
      (only === null || only.has(m.id)),
  );

  // Pre-count cache vs. network so we can show a realistic ETA upfront.
  const needsNetwork = targets.filter(
    (m) => !existsSync(path.join(JW_CACHE_DIR, `${m.id}.json`)),
  ).length;
  const avgDelaySec = (JW_DELAY_MIN_MS + JW_DELAY_MAX_MS) / 2 / 1000;
  const etaMin = Math.ceil((needsNetwork * avgDelaySec) / 60);

  console.log(
    `Resolving deep links for ${targets.length} titles via JustWatch (${targets.length - needsNetwork} cached, ${needsNetwork} new)...`,
  );
  if (needsNetwork > 0) {
    console.log(
      `  Throttle: sequential + ${JW_DELAY_MIN_MS / 1000}-${JW_DELAY_MAX_MS / 1000}s jitter per call. ETA ~${etaMin} min.`,
    );
  }

  let done = 0;
  let hits = 0;
  let cacheHits = 0;
  let networkCalls = 0;
  let consecutiveErrors = 0;
  const byId = new Map();

  for (const m of targets) {
    const cacheFile = path.join(JW_CACHE_DIR, `${m.id}.json`);
    const isCached = existsSync(cacheFile);
    if (!isCached) {
      // Sleep BEFORE the network call so the very first call is also delayed
      // (some bot detectors flag a burst that starts immediately).
      const delay =
        JW_DELAY_MIN_MS +
        Math.floor(Math.random() * (JW_DELAY_MAX_MS - JW_DELAY_MIN_MS));
      await sleep(delay);
    }
    const r = await fetchJustWatchLinks(
      m.id,
      m.title,
      m.year,
      m.kind,
      m.availableOn,
    );
    // On fetch failure keep whatever links the title already had — a
    // transient JustWatch error must not strip working links from the
    // published catalog (mirrors the TMDB carry-forward principle).
    const raw = r === null ? (m.streamingLinks ?? {}) : (r.streamingLinks ?? {});
    // Re-apply URL normalization at read time. Cached entries are frozen at
    // fetch time, so a transform added AFTER an entry was cached never
    // applied to it (e.g. Ted Lasso's Apple link stayed an S1E1 episode URL
    // long after the episode→show rule landed). The transforms are
    // idempotent, so re-running them on every read retroactively fixes
    // stale-normalized entries with zero network cost. The cache file is
    // deliberately NOT rewritten — that would reset mtimes and break
    // refresh:prune's TTL.
    const links = {};
    for (const [svc, url] of Object.entries(raw)) {
      links[svc] = normalizeDeeplink(unwrapDisneyAffiliate(url), svc, m.kind);
    }
    if (isCached) cacheHits++;
    else {
      networkCalls++;
      JW_FETCHED_THIS_RUN.add(m.id);
      if (r === null) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          console.log(
            `\n⚠ JustWatch returned errors for ${consecutiveErrors} requests in a row — likely IP-blocked. Stopping JustWatch enrichment so we don't make it worse. Existing cache is preserved; rerun later.`,
          );
          break;
        }
      } else {
        consecutiveErrors = 0;
      }
    }
    if (Object.keys(links).length > 0) hits++;
    byId.set(m.id, links);
    done++;
    if (done % 25 === 0 || (!isCached && done < 100)) {
      process.stdout.write(
        `  ${done}/${targets.length} (cached: ${cacheHits}, fetched: ${networkCalls}, hits: ${hits})\r`,
      );
    }
  }
  console.log(
    `  ${done}/${targets.length} (cached: ${cacheHits}, fetched: ${networkCalls}, hits: ${hits}) ✓`,
  );
  return titles.map((m) => ({
    ...m,
    streamingLinks: byId.get(m.id) ?? m.streamingLinks ?? {},
  }));
}

// ---------- Manual deep-link overrides ----------

// Read manual-links-{region}.json (if present) and merge per-title URL
// overrides into each title's streamingLinks. Used to hand-fill links for
// titles JustWatch couldn't resolve. Empty-string and null URLs are ignored
// so partially-filled templates don't clobber existing links.
async function mergeManualLinks(titles) {
  const manualPath = path.join(process.cwd(), `manual-links-${REGION}.json`);
  if (!existsSync(manualPath)) return titles;
  let manual;
  try {
    manual = JSON.parse(await readFile(manualPath, "utf8"));
  } catch (e) {
    console.error(`⚠ Failed to parse ${manualPath}: ${e.message}`);
    return titles;
  }
  let mergeCount = 0;
  const out = titles.map((m) => {
    const overrides = manual[m.id];
    if (!overrides) return m;
    const merged = { ...(m.streamingLinks ?? {}) };
    for (const [svc, url] of Object.entries(overrides)) {
      if (typeof url === "string" && url.length > 0) {
        merged[svc] = url;
        mergeCount++;
      }
    }
    return { ...m, streamingLinks: merged };
  });
  console.log(`Merged ${mergeCount} manual deep-link override(s)`);
  return out;
}

// ---------- Reconcile deep links with availability ----------

// Availability (TMDB, wiped each refresh) and deep links (JustWatch, cached
// per tconst) drift apart: when a title gains a service, its cached JW entry
// predates the gain and has no link for it — the UI then falls back to a
// search URL, which can 404 or land on the wrong page. This pass purges the
// stale JW cache entry for exactly those titles and re-fetches them, in the
// same run. It replaces the manual "step 4" of the old procedure, whose
// omission caused the CA Crave and US Peacock dead links.
//
// Titles already fetched fresh this run are skipped: a second fetch can't
// return different data, and a title whose fresh JW result genuinely lacks a
// link (e.g. Amazon-Channel-only offers) is an accepted search fallback.
// Likewise, a cached entry whose forAvailability snapshot still matches the
// title's current availability was already re-fetched for this exact state
// on a previous refresh — skipping it is what keeps the permanent-miss class
// (~56 titles in CA) from burning 4-7s of throttle each, every refresh.
async function reconcileDeepLinks(titles) {
  const stale = [];
  for (const m of titles) {
    if (!(m.availableOn ?? []).some((s) => !(m.streamingLinks ?? {})[s]))
      continue;
    if (JW_FETCHED_THIS_RUN.has(m.id)) continue;
    const cacheFile = path.join(JW_CACHE_DIR, `${m.id}.json`);
    if (!existsSync(cacheFile)) continue;
    let cached;
    try {
      cached = JSON.parse(await readFile(cacheFile, "utf8"));
    } catch {
      cached = null;
    }
    // Entries from before the snapshot existed (no forAvailability) always
    // re-fetch once; the new entry then records the snapshot.
    const snapshot = Array.isArray(cached?.forAvailability)
      ? cached.forAvailability.join(",")
      : null;
    const current = [...(m.availableOn ?? [])].sort().join(",");
    if (snapshot === current) continue;
    stale.push(m);
  }
  if (stale.length === 0) {
    console.log("Reconcile: deep links already match availability ✓");
    return titles;
  }
  console.log(
    `Reconcile: ${stale.length} title(s) gained availability their cached deep links predate — re-fetching...`,
  );
  // Hold each entry before deleting it so a failed re-fetch (transient JW
  // error, or the consecutive-error stop) can restore the cache file —
  // otherwise one bad pass destroys cached links that took throttled hours
  // to accumulate.
  const held = new Map();
  for (const m of stale) {
    const file = path.join(JW_CACHE_DIR, `${m.id}.json`);
    try {
      held.set(m.id, await readFile(file, "utf8"));
    } catch {
      /* nothing to hold */
    }
    await rm(file, { force: true });
  }
  const refreshed = await enrichWithJustWatch(
    titles,
    new Set(stale.map((m) => m.id)),
  );
  let restored = 0;
  for (const [id, body] of held) {
    const file = path.join(JW_CACHE_DIR, `${id}.json`);
    if (!existsSync(file)) {
      await writeFile(file, body);
      restored++;
    }
  }
  if (restored > 0) {
    console.log(
      `  ⚠ ${restored} re-fetch(es) failed — restored their previous cache entries`,
    );
  }
  // Re-merge manual overrides: the re-fetch replaced streamingLinks wholesale
  // for the purged titles, which would clobber any manual fills they had.
  return mergeManualLinks(refreshed);
}

// ---------- Main ----------

function classifyTitleType(t) {
  if (t === "movie") return "movie";
  if (t === "tvSeries" || t === "tvMiniSeries") return "tv";
  return null;
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(PUBLIC_DIR, { recursive: true });

  const basicsGz = path.join(CACHE_DIR, "title.basics.tsv.gz");
  const ratingsGz = path.join(CACHE_DIR, "title.ratings.tsv.gz");

  // --fresh wipes the caches a refresh is supposed to re-validate (IMDb TSVs
  // here; each region's watch-providers inside the region loop), replacing
  // the manual rm steps of the old procedure. JustWatch/TMDB/cert caches are
  // intentionally kept.
  const FRESH = process.argv.includes("--fresh");
  if (FRESH) {
    await rm(basicsGz, { force: true });
    await rm(ratingsGz, { force: true });
    console.log("Fresh mode: wiped IMDb TSVs");
  }

  await download(RATINGS_URL, ratingsGz);
  await download(BASICS_URL, basicsGz);

  // Use the lower of the two thresholds when building the qualifying set —
  // we'll re-filter by kind-specific threshold during the basics pass.
  const QUALIFY_RATING = Math.min(MIN_RATING_MOVIE, MIN_RATING_TV);

  console.log("Reading ratings...");
  const qualifying = new Map();
  for await (const row of readTsv(ratingsGz)) {
    const rating = parseFloat(row.averageRating);
    const votes = parseInt(row.numVotes, 10);
    if (rating >= QUALIFY_RATING && votes >= MIN_VOTES) {
      qualifying.set(row.tconst, { rating, votes });
    }
  }
  console.log(`  ${qualifying.size.toLocaleString()} titles meet thresholds`);

  console.log("Reading basics...");
  const titles = [];
  let movieCount = 0;
  let tvCount = 0;
  for await (const row of readTsv(basicsGz)) {
    const kind = classifyTitleType(row.titleType);
    if (!kind) continue;
    const r = qualifying.get(row.tconst);
    if (!r) continue;
    const minRating = kind === "tv" ? MIN_RATING_TV : MIN_RATING_MOVIE;
    if (r.rating < minRating) continue;
    titles.push({
      id: row.tconst,
      kind,
      title: row.primaryTitle,
      year: row.startYear ? parseInt(row.startYear, 10) : null,
      runtime: row.runtimeMinutes ? parseInt(row.runtimeMinutes, 10) : null,
      genres: row.genres ? row.genres.split(",") : [],
      rating: r.rating,
      votes: r.votes,
    });
    if (kind === "movie") movieCount++;
    else tvCount++;
  }
  console.log(
    `  kept ${titles.length.toLocaleString()} (${movieCount.toLocaleString()} movies, ${tvCount.toLocaleString()} TV)`,
  );

  titles.sort((a, b) => b.rating - a.rating);

  // Region-independent enrichment — runs once no matter how many regions.
  const enriched = await enrichWithTmdb(titles);
  const withCerts = await enrichWithCerts(enriched);

  for (const region of REGIONS_TO_RUN) {
    initRegion(region);
    if (REGIONS_TO_RUN.length > 1) console.log(`\n=== ${COUNTRY} ===`);
    if (FRESH) {
      await rm(WATCH_CACHE_DIR.movie, { recursive: true, force: true });
      await rm(WATCH_CACHE_DIR.tv, { recursive: true, force: true });
      console.log(`Fresh mode: wiped watch-${region} availability caches`);
    }

    const withAvailability = await enrichWithWatchProviders(withCerts);
    const withDeny = await applyDenyList(withAvailability);
    const withLinks = await enrichWithJustWatch(withDeny);
    const withManual = await mergeManualLinks(withLinks);
    const reconciled = await reconcileDeepLinks(withManual);
    const final = reconciled.filter(
      (m) => m.availableOn && m.availableOn.length > 0,
    );
    const finalMovies = final.filter((m) => m.kind === "movie").length;
    const finalTv = final.filter((m) => m.kind === "tv").length;
    console.log(
      `  ${final.length.toLocaleString()} streaming in ${COUNTRY} (${finalMovies.toLocaleString()} movies, ${finalTv.toLocaleString()} TV)`,
    );

    const out = path.join(PUBLIC_DIR, OUTPUT_FILENAME);
    const json = JSON.stringify(final);
    await writeFile(out, json);
    const sizeMb = (json.length / 1024 / 1024).toFixed(2);
    console.log(`✓ Wrote ${out} (${sizeMb} MB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
