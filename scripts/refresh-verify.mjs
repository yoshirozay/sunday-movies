// Post-refresh link-rot check for the services that return honest HTTP 404s.
//
// Most services lie about dead pages (200 + SPA shell, 405 on HEAD, or
// false 404s on valid URLs — see the per-region REFRESH-*.md "Probing
// gotchas" tables). This script only probes the (region, service) pairs the
// docs have verified to return a real 404 for a dead page, so a 404 here is
// a confirmed dead link:
//
//   us: paramount          gb: paramount, now          au: paramount, stan, disney
//   ca: none (all five CA services lie — manual spot-checks only)
//
// Hulu has its own GET-based scanner (check-hulu-links.mjs) — HEAD lies for
// that service in both directions.
//
// Only an exact HTTP 404 counts as broken. Timeouts, 403 bot-blocks, Stan's
// 248s, and other 4xx/5xx are inconclusive and left alone.
//
// Usage:
//   node scripts/refresh-verify.mjs --region=au          # report only (fast HEAD pass)
//   node scripts/refresh-verify.mjs --region=all --purge # also purge JW cache
//   node scripts/refresh-verify.mjs --region=us --strip  # strip dead links
//   node scripts/refresh-verify.mjs --region=us --deep   # + GET classifiers for
//        prime/apple/netflix/disney/hbo (slow, ~10-15 min/region; also flags
//        WRONG-TITLE links where a stale id serves a different movie)
//
// Escalation ladder for a confirmed 404:
//   1. --purge deletes .data-cache/justwatch-{region}/{tconst}.json so the
//      next fetch-data re-resolves it fresh from JustWatch — recovering
//      moved URLs instead of dropping the title.
//   2. If the re-fetched URL is *still* dead (JustWatch itself is stale),
//      --strip removes just that link from the cached entry and stamps
//      forAvailability with the title's current availability. The title
//      keeps its service attribution (TMDB + JW both still claim it's on
//      the service — only the URL rotted) and the UI falls back to the
//      service's search page. The snapshot stops the reconcile from
//      re-fetching the dead URL, while refresh:prune's TTL retries it
//      eventually in case JustWatch fixed the link. Hand-fill
//      manual-links-{region}.json for high-value titles.
//
// After either mode, re-run fetch-data for the region to rebuild the JSON.

import { readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ALL_REGIONS = ["ca", "us", "gb", "au"];

// (region, service) pairs with verified honest-404 behavior. Keep in sync
// with the "Probing gotchas" tables in REFRESH-{region}.md.
const DETECTABLE = {
  ca: [],
  us: ["paramount"],
  gb: ["paramount", "now"],
  au: ["paramount", "stan", "disney"],
};

const CONCURRENCY = 10;
const TIMEOUT_MS = 10000;

function parseArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(`--${name}=`.length) : null;
}

const regionArg = parseArg("region") ?? "all";
const REGIONS = regionArg === "all" ? [...ALL_REGIONS] : regionArg.split(",");
for (const r of REGIONS) {
  if (!ALL_REGIONS.includes(r)) {
    console.error(`Invalid --region: ${r}. Use ca, us, gb, au, or all.`);
    process.exit(1);
  }
}
const PURGE = process.argv.includes("--purge");
const STRIP = process.argv.includes("--strip");
// --deep adds full-GET classification for the five services with verified
// GET signals (slow: ~10-15 min per region, polite per-host pacing).
const DEEP = process.argv.includes("--deep");
// --offers (implies meaningful only with --deep) additionally flags Prime
// pages that are valid but NOT included with Prime (expired rights /
// rent-buy-only — the class TMDB and JustWatch both lie about). ONLY run
// this for the region your IP is geolocated in: Prime personalizes offer
// state by IP, so probing another region's catalog reports YOUR region's
// offers, not theirs.
const OFFERS = process.argv.includes("--offers");
if (PURGE && STRIP) {
  // --purge deletes the very cache entries --strip would patch; combined,
  // strip silently no-ops. Force one rung of the ladder at a time.
  console.error("Use either --purge or --strip, not both (see escalation ladder in the header).");
  process.exit(1);
}

async function checkUrl(url) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
    });
    return { status: res.status };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- Deep (GET) verification ----------
//
// Five services that lie to HEAD turn out to expose a reliable signal on a
// full GET with browser headers (characterized empirically 2026-06-11, one
// probe agent per host; see REFRESH.md § Deep link verification):
//   prime    valid = 200 + <title> "Prime Video: …"; dead = 404
//   apple    valid = 200; dead = 404 (holds for /movie, /show and /episode)
//   netflix  dead = 404; AND a 200 whose og:title doesn't contain the
//            expected name is a WRONG-TITLE (stale ids can alias to a
//            different real title — verified live)
//   disney   valid = 200 + og:title; dead = 404
//   hbo      /show|/movies|/shows shapes: valid = 200, dead = 404 ("Oops").
//            /video/watch/{uuid} player routes have no signal — skipped.
// Crave and Peacock have NO server-side signal (static SPA shells) and are
// excluded. Wrong-title findings are report-only; dead findings flow into
// the same --purge/--strip ladder as HEAD findings.

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// Services with a verified GET classifier, per region. AU's hbomax uses
// locale-prefixed URL shapes that were not in the characterization run —
// deliberately excluded until probed.
const DEEP_SERVICES = {
  ca: ["prime", "apple", "netflix", "disney"],
  us: ["prime", "apple", "netflix", "disney", "hbo"],
  gb: ["prime", "apple", "netflix", "disney"],
  au: ["prime", "apple", "netflix", "disney"],
};

// Lowercase, entity-decode the common cases, strip non-alphanumerics — so
// "Schindler&#x27;s List" matches "Schindlers List" etc.
function normalizeName(s) {
  return (s ?? "")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Dice coefficient over character bigrams. Catalog titles and og:titles
// legitimately differ in spelling/numbering ("Colour"/"Color",
// "Extraction II"/"Extraction 2", "Weak Hero Class 1"/"Weak Hero") — exact
// containment flags those as wrong-title. Similarity ≥ 0.7 = same title;
// a stale id aliased to a genuinely different movie scores far below.
function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 1;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

function extract(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

async function probeUrl(url) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS * 2);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal: ctrl.signal,
    });
    const body = await res.text();
    return {
      status: res.status,
      finalUrl: res.url,
      title: extract(body, /<title[^>]*>([^<]*)<\/title>/i),
      ogTitle: extract(
        body,
        /property=["']og:title["'][^>]+content=["']([^"']*)["']/i,
      ),
      // Prime offer-state markers (characterized 2026-06-11 against Amazon
      // originals vs a user-confirmed rights-expired title): pages for
      // titles included with Prime carry "benefitId":"Prime" and an
      // above-the-fold signup/play CTA; not-included pages (expired rights,
      // rent/buy-only) carry neither. Logged-out SSR, stable on re-probe.
      primeIncluded:
        /"benefitId":"Prime"/.test(body) ||
        /atf_mv_signu|ch_lo_atf|atf_tv_signu/.test(body),
    };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(timeout);
  }
}

// classify(probe, expectedName) → "ok" | "dead" | "wrong-title" | "inconclusive"
const DEEP_RULES = {
  prime: {
    eligible: () => true,
    // Amazon throttles at ~1s pacing (the whole lane goes inconclusive);
    // the 4-6s pacing used during characterization passes cleanly.
    delayMin: 4000,
    delayMax: 6500,
    classify(p) {
      if (p.error) return "inconclusive";
      if (p.status === 404) return "dead";
      if (p.status === 200 && /^Prime Video: /i.test(p.title ?? "")) {
        // Offer-state check (--offers only): a valid page whose SSR lacks
        // the included-with-Prime markers is the "false-flatrate /
        // expired-rights" class — the page loads but there's no Play, only
        // rent/buy or an unavailability banner. GEO CONSTRAINT: Prime
        // personalizes offers by IP, so this verdict is only meaningful
        // when the probed region matches the machine's geography — that's
        // why it's opt-in. Report-only; remediation is deny-{region}.json
        // after eyeballing the page.
        if (OFFERS && !p.primeIncluded) return "unavailable";
        return "ok";
      }
      return "inconclusive"; // 503s etc. — retried by the caller
    },
  },
  apple: {
    eligible: () => true,
    classify(p) {
      if (p.error) return "inconclusive";
      if (p.status === 404) return "dead";
      if (p.status === 200) return "ok";
      return "inconclusive";
    },
  },
  netflix: {
    eligible: () => true,
    classify(p, expectedName) {
      if (p.error) return "inconclusive";
      if (p.status === 404) return "dead";
      if (p.status !== 200) return "inconclusive";
      // Stale Netflix ids can 200-alias to a DIFFERENT real title. Only
      // judge when og:title is present; a missing tag is inconclusive.
      if (!p.ogTitle) return "inconclusive";
      // og:title shape: "Watch {Name} | Netflix [Official Site]"
      const core = p.ogTitle.replace(/^\s*Watch\s+/i, "").replace(/\s*\|\s*Netflix.*$/i, "");
      return nameSimilarity(normalizeName(core), normalizeName(expectedName)) >= 0.7
        ? "ok"
        : "wrong-title";
    },
  },
  disney: {
    eligible: () => true,
    classify(p) {
      if (p.error) return "inconclusive";
      if (p.status === 404) return "dead";
      if (p.status === 200) return "ok";
      return "inconclusive";
    },
  },
  hbo: {
    // The /video/watch/{uuid} player route serves an identical shell for
    // valid and dead ids — no signal, skip those links entirely.
    eligible: (url) =>
      /hbomax\.com\/(show|shows|movies)\//.test(url) &&
      !/\/video\/watch\//.test(url),
    classify(p) {
      if (p.error) return "inconclusive";
      if (p.status === 404) return "dead";
      if (p.status === 200) return "ok";
      return "inconclusive";
    },
  },
};

const DEEP_DELAY_MIN_MS = 700;
const DEEP_DELAY_MAX_MS = 1300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --deep-services=prime,netflix restricts the deep lanes (e.g. to re-run a
// single throttled lane without re-probing the clean ones).
const DEEP_ONLY = (() => {
  const arg = process.argv.find((a) => a.startsWith("--deep-services="));
  return arg ? arg.slice("--deep-services=".length).split(",") : null;
})();

async function deepCheckRegion(region) {
  let services = DEEP_SERVICES[region] ?? [];
  if (DEEP_ONLY) services = services.filter((s) => DEEP_ONLY.includes(s));
  if (services.length === 0) return { dead: [], wrongTitle: [], checked: 0, skipped: 0, inconclusive: 0 };
  const titles = JSON.parse(
    await readFile(
      path.join(process.cwd(), "public", `movies-${region}.json`),
      "utf8",
    ),
  );

  const byService = new Map(services.map((s) => [s, []]));
  let skipped = 0;
  for (const t of titles) {
    for (const svc of services) {
      if (!(t.availableOn ?? []).includes(svc)) continue;
      const url = t.streamingLinks?.[svc];
      if (!url) continue;
      if (!DEEP_RULES[svc].eligible(url)) {
        skipped++;
        continue;
      }
      byService.get(svc).push({
        tconst: t.id,
        title: t.title,
        year: t.year,
        kind: t.kind,
        rating: t.rating,
        service: svc,
        url,
      });
    }
  }

  const counts = [...byService.entries()]
    .map(([s, list]) => `${s}:${list.length}`)
    .join(", ");
  console.log(
    `${region.toUpperCase()} deep scan: ${counts}${skipped ? ` (${skipped} skipped — no-signal URL shape)` : ""}. Hosts run in parallel, each sequential + jitter.`,
  );

  const results = [];
  let done = 0;
  const total = [...byService.values()].reduce((n, l) => n + l.length, 0);
  // One sequential lane per service host; lanes run concurrently.
  await Promise.all(
    [...byService.entries()].map(async ([svc, list]) => {
      const dMin = DEEP_RULES[svc].delayMin ?? DEEP_DELAY_MIN_MS;
      const dMax = DEEP_RULES[svc].delayMax ?? DEEP_DELAY_MAX_MS;
      for (const target of list) {
        await sleep(dMin + Math.random() * (dMax - dMin));
        let probe = await probeUrl(target.url);
        let verdict = DEEP_RULES[svc].classify(probe, target.title);
        // Re-probe non-ok once after a cooldown: Prime throws transient
        // 503s, and a one-off network blip must not become a "dead".
        if (verdict !== "ok") {
          await sleep(3000);
          probe = await probeUrl(target.url);
          verdict = DEEP_RULES[svc].classify(probe, target.title);
        }
        results.push({ ...target, verdict, probe });
        done++;
        if (done % 20 === 0)
          process.stdout.write(`  deep ${done}/${total}\r`);
      }
    }),
  );

  const dead = results.filter((r) => r.verdict === "dead");
  const wrongTitle = results.filter((r) => r.verdict === "wrong-title");
  const unavailable = results.filter((r) => r.verdict === "unavailable");
  const inconclusive = results.filter((r) => r.verdict === "inconclusive").length;
  // Per-service verdict histogram — "0 dead" is only meaningful if a lane
  // wasn't wholesale throttled into inconclusive.
  const perSvc = {};
  for (const r of results) {
    perSvc[r.service] ??= {};
    // Annotate inconclusives with the status/error so a throttled lane is
    // diagnosable from the summary line.
    const key =
      r.verdict === "inconclusive"
        ? `inconclusive(${r.probe.status ?? r.probe.error ?? "?"})`
        : r.verdict;
    perSvc[r.service][key] = (perSvc[r.service][key] ?? 0) + 1;
  }
  console.log(
    `  deep ${done}/${total} ✓ — ${dead.length} dead, ${wrongTitle.length} wrong-title, ${unavailable.length} unavailable, ${inconclusive} inconclusive`,
  );
  for (const [svc, v] of Object.entries(perSvc)) {
    console.log(
      `    ${svc}: ${Object.entries(v).map(([k, n]) => `${k}:${n}`).join(", ")}`,
    );
  }
  return { dead, wrongTitle, unavailable, checked: total, skipped, inconclusive };
}

async function checkRegion(region) {
  const services = DETECTABLE[region];
  if (services.length === 0) {
    console.log(`${region.toUpperCase()}: no honest-404 services — skipping.`);
    return { region, broken: [] };
  }
  const titles = JSON.parse(
    await readFile(
      path.join(process.cwd(), "public", `movies-${region}.json`),
      "utf8",
    ),
  );
  const targets = [];
  for (const t of titles) {
    for (const svc of services) {
      // Only check links the UI can actually surface — a streamingLinks
      // entry for a service that's not in availableOn is unreachable.
      if (!(t.availableOn ?? []).includes(svc)) continue;
      const url = t.streamingLinks?.[svc];
      if (url) {
        targets.push({
          tconst: t.id,
          title: t.title,
          year: t.year,
          kind: t.kind,
          rating: t.rating,
          service: svc,
          url,
        });
      }
    }
  }
  console.log(
    `${region.toUpperCase()}: checking ${targets.length} URLs across ${services.join(", ")}...`,
  );

  const results = new Array(targets.length);
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (cursor < targets.length) {
      const i = cursor++;
      results[i] = { ...targets[i], result: await checkUrl(targets[i].url) };
      done++;
      if (done % 25 === 0) {
        process.stdout.write(`  ${done}/${targets.length}\r`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const isInconclusive = (r) =>
    r.result.error ||
    (r.result.status && r.result.status >= 400 && r.result.status !== 404);

  // Rate-limited or flaky HEADs can hide real 404s — and a transient 404
  // must not be treated as confirmed rot (--strip would remove a healthy
  // link and pin it removed). Re-probe BOTH groups once, sequentially,
  // after a cooldown: a 404 only counts if it reproduces.
  const recheck = results.filter(
    (r) => isInconclusive(r) || r.result.status === 404,
  );
  if (recheck.length > 0 && recheck.length < targets.length / 2) {
    await new Promise((r) => setTimeout(r, 3000));
    for (const r of recheck) {
      r.result = await checkUrl(r.url);
    }
  }

  const broken = results.filter((r) => r.result.status === 404);
  const inconclusive = results.filter(isInconclusive);
  const histogram = {};
  for (const r of results) {
    const key = r.result.status ?? r.result.error ?? "?";
    histogram[key] = (histogram[key] ?? 0) + 1;
  }
  console.log(
    `  ${done}/${targets.length} ✓ — ${broken.length} confirmed 404, ${inconclusive.length} inconclusive (${Object.entries(histogram).map(([k, v]) => `${k}:${v}`).join(", ")})`,
  );
  return { region, broken, checked: targets.length, inconclusive: inconclusive.length };
}

async function main() {
  const lines = [`# Link-rot check — ${REGIONS.map((r) => r.toUpperCase()).join(", ")}`, ""];
  let totalBroken = 0;

  for (const region of REGIONS) {
    const head = await checkRegion(region);
    const deep = DEEP
      ? await deepCheckRegion(region)
      : { dead: [], wrongTitle: [], unavailable: [], checked: 0, skipped: 0, inconclusive: 0 };
    const allBroken = [...head.broken, ...deep.dead];
    const checked = (head.checked ?? 0) + deep.checked;
    const inconclusive = (head.inconclusive ?? 0) + deep.inconclusive;
    totalBroken += allBroken.length;
    if (DETECTABLE[region].length === 0 && deep.checked === 0) continue;

    if ((deep.unavailable ?? []).length > 0) {
      lines.push(
        `**${deep.unavailable.length} NOT-INCLUDED-WITH-PRIME link(s)** (valid page, but no Play — expired rights or rent/buy-only; both TMDB and JW report these as flatrate). Eyeball each page, then add confirmed ones to \`deny-${region}.json\`:`,
      );
      for (const u of deep.unavailable) {
        lines.push(`- ${u.title} (\`"${u.tconst}": ["prime"]\`) — \`${u.url}\``);
      }
      lines.push("");
      console.log(
        `  ${deep.unavailable.length} not-included-with-prime link(s) — see report (manual review → deny-list)`,
      );
    }

    if (deep.wrongTitle.length > 0) {
      lines.push(
        `**${deep.wrongTitle.length} WRONG-TITLE link(s)** (200 but the page is a different title — review by hand, do not auto-strip):`,
      );
      for (const w of deep.wrongTitle) {
        lines.push(
          `- ${w.title} (${w.tconst}, ${w.service}) → og:title "${w.probe.ogTitle}" — \`${w.url}\``,
        );
      }
      lines.push("");
      console.log(
        `  ${deep.wrongTitle.length} wrong-title link(s) — see report (manual review)`,
      );
    }

    // Dead links that came from manual-links-{region}.json can't be fixed
    // by cache surgery — mergeManualLinks re-applies them on every rebuild.
    // Route those to the manual file instead of purge/strip.
    let manual = {};
    const manualPath = path.join(process.cwd(), `manual-links-${region}.json`);
    if (existsSync(manualPath)) {
      try {
        manual = JSON.parse(await readFile(manualPath, "utf8"));
      } catch {
        /* unreadable — treat all as JW-sourced */
      }
    }
    const manualDead = allBroken.filter(
      (b) => manual[b.tconst]?.[b.service] === b.url,
    );
    const broken = allBroken.filter((b) => !manualDead.includes(b));
    if (manualDead.length > 0) {
      console.log(
        `  ${manualDead.length} dead link(s) come from manual-links-${region}.json — fix them there (purge/strip can't help):`,
      );
      for (const b of manualDead) {
        console.log(`    - ${b.title} (${b.tconst}) ${b.service}`);
      }
      lines.push(
        `**${manualDead.length} dead manual override(s)** — edit \`manual-links-${region}.json\`: ${manualDead.map((b) => `${b.title} (${b.tconst}, ${b.service})`).join("; ")}`,
      );
      lines.push("");
    }

    lines.push(`## ${region.toUpperCase()} — ${allBroken.length} of ${checked} confirmed 404 (${inconclusive} inconclusive)`);
    lines.push("");
    if (allBroken.length > 0) {
      lines.push("| Rating | Year | Kind | Service | Title | tconst | Broken URL |");
      lines.push("|---:|---:|---|---|---|---|---|");
      allBroken.sort((a, b) => b.rating - a.rating);
      for (const t of allBroken) {
        lines.push(
          `| ${t.rating.toFixed(1)} | ${t.year ?? "—"} | ${t.kind} | ${t.service} | ${t.title} | [${t.tconst}](https://www.imdb.com/title/${t.tconst}/) | \`${t.url}\` |`,
        );
      }
      lines.push("");
    }

    if (PURGE && broken.length > 0) {
      const tconsts = [...new Set(broken.map((b) => b.tconst))];
      for (const tc of tconsts) {
        await rm(path.join(".data-cache", `justwatch-${region}`, `${tc}.json`), {
          force: true,
        });
      }
      console.log(
        `  purged ${tconsts.length} JustWatch cache entr${tconsts.length === 1 ? "y" : "ies"} — re-run fetch-data --region=${region} to re-resolve`,
      );
      lines.push(`_Purged ${tconsts.length} JW cache entries; re-run \`fetch-data --region=${region}\` to re-resolve._`);
      lines.push("");
    }

    if (STRIP && broken.length > 0) {
      const catalog = new Map(
        JSON.parse(
          await readFile(
            path.join(process.cwd(), "public", `movies-${region}.json`),
            "utf8",
          ),
        ).map((t) => [t.id, t]),
      );
      let stripped = 0;
      for (const b of broken) {
        const cachePath = path.join(
          ".data-cache",
          `justwatch-${region}`,
          `${b.tconst}.json`,
        );
        let entry;
        try {
          entry = JSON.parse(await readFile(cachePath, "utf8"));
        } catch {
          continue;
        }
        // Only strip the exact URL we probed — if the cache holds a different
        // (e.g. newer) link than the published one, leave it for the next
        // rebuild + verify cycle to judge.
        if (entry.streamingLinks?.[b.service] !== b.url) continue;
        delete entry.streamingLinks[b.service];
        // Stamp the snapshot so the reconcile doesn't immediately re-fetch
        // the same stale JustWatch answer. refresh:prune's TTL retries it.
        entry.forAvailability = [
          ...(catalog.get(b.tconst)?.availableOn ?? []),
        ].sort();
        await writeFile(cachePath, JSON.stringify(entry));
        stripped++;
      }
      console.log(
        `  stripped ${stripped} dead link(s) from the JW cache — re-run fetch-data --region=${region} to rebuild the catalog`,
      );
      lines.push(`_Stripped ${stripped} dead links; re-run \`fetch-data --region=${region}\` to rebuild._`);
      lines.push("");
    }
  }

  const reportPath = path.join(process.cwd(), "scripts", "rot-check.md");
  await writeFile(reportPath, lines.join("\n"));
  console.log(`\nReport: scripts/rot-check.md`);
  if (totalBroken > 0) {
    if (STRIP) {
      console.log(
        `${totalBroken} confirmed dead link(s) stripped — re-run fetch-data for the affected region(s) to rebuild the catalog JSON.`,
      );
    } else if (PURGE) {
      console.log(
        `${totalBroken} confirmed dead link(s) purged — re-run fetch-data for the affected region(s), then verify again. Escalate to --strip for any that come back dead (do NOT re-run --purge on those; it just re-fetches the same stale JustWatch answer).`,
      );
    } else {
      console.log(
        `${totalBroken} confirmed dead link(s). Escalation: --purge first (re-resolves moved URLs via fetch-data), then --strip for links that persist.`,
      );
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
