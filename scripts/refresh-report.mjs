// Compares the freshly-fetched catalog against the baseline (the JSONs that
// were on main before the refresh), runs sanity guardrails, and writes a
// markdown report that becomes the PR body for the automated refresh.
//
// Two jobs:
//   1. Sanity guardrails. Exits non-zero if the refresh looks broken
//      (catalogs shrank too much, a service vanished, schema violations).
//      These are the things a human reviewer can't catch by eyeballing
//      a 2 MB JSON diff — so we fail loudly in CI instead of opening a PR.
//   2. Diff report. Per-region added / removed / moved-service tables in
//      markdown. The PR body lets a human spot-check specific titles on
//      the preview deployment vs. the live site.
//
// Usage:
//   node scripts/refresh-report.mjs \
//     --baseline-dir=/tmp/baseline \
//     --new-dir=public \
//     --output=refresh-report.md
//
// Baseline files are named movies-{region}.json (same as production).
// Missing baselines (first run, new region) are reported as "new region"
// and skip the sanity check.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const REGIONS = ["ca", "us", "gb", "au"];

// Per-region service lists. Mirrors lib/types.ts REGION_SERVICES — kept
// here too so this script has no app dependencies.
const REGION_SERVICES = {
  ca: ["netflix", "prime", "disney", "crave", "apple"],
  us: ["netflix", "prime", "hulu", "hbo", "paramount", "disney", "peacock", "apple"],
  gb: ["netflix", "prime", "disney", "paramount", "now", "apple"],
  au: ["netflix", "prime", "disney", "paramount", "stan", "hbomax", "apple"],
};

const VALID_SERVICES = new Set([
  "netflix", "prime", "hulu", "hbo", "paramount", "disney",
  "crave", "peacock", "now", "stan", "hbomax", "apple",
]);

const VALID_KINDS = new Set(["movie", "tv"]);

// Guardrail thresholds. Tuned to catch catastrophic refreshes (API broke,
// IP got blocked mid-run, a service ID changed) without false-flagging
// normal week-to-week churn.
const TOTAL_SHRINK_MAX = 0.15;   // fail if catalog shrinks by >15%
const TOTAL_GROW_MAX = 0.50;     // fail if catalog grows by >50% (dedup bug)
const SERVICE_SHRINK_MAX = 0.25; // fail if any service loses >25% of titles

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return {
    baselineDir: args["baseline-dir"] ?? "/tmp/baseline",
    newDir: args["new-dir"] ?? "public",
    output: args["output"] ?? "refresh-report.md",
  };
}

async function loadCatalog(dir, region) {
  const file = path.join(dir, `movies-${region}.json`);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw);
}

// Schema check. Returns an array of human-readable error strings — empty
// means the file is well-formed. We only check fields the app actually
// reads at runtime; soft fields (overview, originalLanguage) can be missing.
function validateSchema(catalog) {
  const errors = [];
  if (!Array.isArray(catalog)) {
    errors.push("top-level value is not an array");
    return errors;
  }
  const seenIds = new Set();
  let i = 0;
  for (const m of catalog) {
    const prefix = `entry[${i}]`;
    if (typeof m.id !== "string" || !/^tt\d+$/.test(m.id)) {
      errors.push(`${prefix}: missing/malformed id`);
    } else if (seenIds.has(m.id)) {
      errors.push(`${prefix}: duplicate id ${m.id}`);
    } else {
      seenIds.add(m.id);
    }
    if (typeof m.title !== "string" || !m.title) errors.push(`${prefix}: missing title`);
    if (!VALID_KINDS.has(m.kind)) errors.push(`${prefix} (${m.id}): invalid kind ${m.kind}`);
    if (typeof m.rating !== "number") errors.push(`${prefix} (${m.id}): rating not numeric`);
    if (typeof m.votes !== "number") errors.push(`${prefix} (${m.id}): votes not numeric`);
    if (m.availableOn !== undefined) {
      if (!Array.isArray(m.availableOn)) {
        errors.push(`${prefix} (${m.id}): availableOn is not an array`);
      } else {
        for (const s of m.availableOn) {
          if (!VALID_SERVICES.has(s)) {
            errors.push(`${prefix} (${m.id}): unknown service "${s}"`);
          }
        }
      }
    }
    if (errors.length > 50) {
      errors.push(`... (truncated, ${catalog.length - i - 1} entries remain)`);
      break;
    }
    i++;
  }
  return errors;
}

function countByService(catalog, services) {
  const counts = Object.fromEntries(services.map((s) => [s, 0]));
  for (const m of catalog) {
    for (const s of m.availableOn ?? []) {
      if (s in counts) counts[s]++;
    }
  }
  return counts;
}

function diffRegion(baseline, next) {
  const baseById = new Map(baseline.map((m) => [m.id, m]));
  const nextById = new Map(next.map((m) => [m.id, m]));

  const added = [];
  const removed = [];
  const moved = [];

  for (const [id, m] of nextById) {
    if (!baseById.has(id)) {
      added.push(m);
    } else {
      const prev = baseById.get(id);
      const prevSet = new Set(prev.availableOn ?? []);
      const nextSet = new Set(m.availableOn ?? []);
      // "moved" = the set of services differs. Could be added-service,
      // removed-service, or full swap.
      if (
        prevSet.size !== nextSet.size ||
        [...prevSet].some((s) => !nextSet.has(s))
      ) {
        moved.push({ movie: m, from: [...prevSet], to: [...nextSet] });
      }
    }
  }
  for (const [id, m] of baseById) {
    if (!nextById.has(id)) removed.push(m);
  }
  return { added, removed, moved };
}

function formatTitle(m) {
  const yr = m.year ? ` (${m.year})` : "";
  return `${m.title}${yr}`;
}

function delta(prev, next) {
  const d = next - prev;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d}`;
}

function renderRegionTable(rows) {
  // rows: [{ region, prevTotal, nextTotal, perService: { svc: { prev, next } } }]
  const lines = [];
  lines.push("| Region | Titles | Δ | Per-service deltas |");
  lines.push("|--------|-------:|---:|---|");
  for (const r of rows) {
    const services = REGION_SERVICES[r.region]
      .map((s) => {
        const ps = r.perService[s] ?? { prev: 0, next: 0 };
        return `${s} ${ps.next} (${delta(ps.prev, ps.next)})`;
      })
      .join(", ");
    lines.push(
      `| ${r.region.toUpperCase()} | ${r.nextTotal} | ${delta(r.prevTotal, r.nextTotal)} | ${services} |`,
    );
  }
  return lines.join("\n");
}

function renderTitleList(titles, formatter, limit = 50) {
  const sorted = [...titles].sort((a, b) => {
    const ar = a.movie?.rating ?? a.rating ?? 0;
    const br = b.movie?.rating ?? b.rating ?? 0;
    return br - ar;
  });
  const lines = sorted.slice(0, limit).map(formatter);
  if (sorted.length > limit) {
    lines.push(`- _... and ${sorted.length - limit} more_`);
  }
  return lines.join("\n");
}

async function main() {
  const { baselineDir, newDir, output } = parseArgs();
  const failures = [];
  const regionRows = [];
  const regionSections = [];

  for (const region of REGIONS) {
    const baseline = await loadCatalog(baselineDir, region);
    const next = await loadCatalog(newDir, region);

    if (!next) {
      failures.push(`[${region}] new catalog missing at ${newDir}/movies-${region}.json`);
      continue;
    }

    // Schema validation runs unconditionally.
    const schemaErrors = validateSchema(next);
    if (schemaErrors.length) {
      for (const e of schemaErrors) failures.push(`[${region}] schema: ${e}`);
    }

    const services = REGION_SERVICES[region];
    const nextByService = countByService(next, services);

    if (!baseline) {
      regionSections.push({
        region,
        markdown: `### ${region.toUpperCase()} — new region (no baseline)\n\nTitles: ${next.length}`,
      });
      regionRows.push({
        region,
        prevTotal: 0,
        nextTotal: next.length,
        perService: Object.fromEntries(
          services.map((s) => [s, { prev: 0, next: nextByService[s] }]),
        ),
      });
      continue;
    }

    // Total-count guardrails
    if (baseline.length > 0) {
      const ratio = next.length / baseline.length;
      if (ratio < 1 - TOTAL_SHRINK_MAX) {
        failures.push(
          `[${region}] total shrank ${(((1 - ratio) * 100) | 0)}% (${baseline.length} → ${next.length}); threshold ${TOTAL_SHRINK_MAX * 100}%`,
        );
      } else if (ratio > 1 + TOTAL_GROW_MAX) {
        failures.push(
          `[${region}] total grew ${(((ratio - 1) * 100) | 0)}% (${baseline.length} → ${next.length}); threshold ${TOTAL_GROW_MAX * 100}%`,
        );
      }
    }

    // Per-service shrink guardrails
    const prevByService = countByService(baseline, services);
    for (const s of services) {
      const p = prevByService[s];
      const n = nextByService[s];
      if (p > 20 && n / p < 1 - SERVICE_SHRINK_MAX) {
        failures.push(
          `[${region}] service "${s}" shrank ${(((1 - n / p) * 100) | 0)}% (${p} → ${n}); threshold ${SERVICE_SHRINK_MAX * 100}%`,
        );
      }
    }

    regionRows.push({
      region,
      prevTotal: baseline.length,
      nextTotal: next.length,
      perService: Object.fromEntries(
        services.map((s) => [s, { prev: prevByService[s], next: nextByService[s] }]),
      ),
    });

    const { added, removed, moved } = diffRegion(baseline, next);

    const addedLines = renderTitleList(added, (m) => {
      const svcs = (m.availableOn ?? []).join(", ") || "no service";
      return `- ${formatTitle(m)} → ${svcs}`;
    });
    const removedLines = renderTitleList(removed, (m) => {
      const svcs = (m.availableOn ?? []).join(", ") || "no service";
      return `- ${formatTitle(m)} — was on ${svcs}`;
    });
    const movedLines = renderTitleList(moved, ({ movie, from, to }) => {
      return `- ${formatTitle(movie)}: ${from.join(",") || "—"} → ${to.join(",") || "—"}`;
    });

    const section = [
      `### ${region.toUpperCase()}`,
      ``,
      `Titles: **${next.length}** (${delta(baseline.length, next.length)})`,
      ``,
      `<details><summary>Added — ${added.length}</summary>`,
      ``,
      addedLines || "_none_",
      ``,
      `</details>`,
      ``,
      `<details><summary>Removed — ${removed.length}</summary>`,
      ``,
      removedLines || "_none_",
      ``,
      `</details>`,
      ``,
      `<details><summary>Moved services — ${moved.length}</summary>`,
      ``,
      movedLines || "_none_",
      ``,
      `</details>`,
      ``,
    ].join("\n");
    regionSections.push({ region, markdown: section });
  }

  // Stdout summary (useful for CI logs)
  for (const r of regionRows) {
    console.log(
      `[${r.region}] ${r.nextTotal} (${delta(r.prevTotal, r.nextTotal)})`,
    );
  }
  if (failures.length) {
    console.error(`\n${failures.length} guardrail failure(s):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
  } else {
    console.log("\nAll guardrails passed.");
  }

  const header = failures.length
    ? `## ⚠️ Refresh failed sanity checks\n\n${failures.map((f) => `- ${f}`).join("\n")}\n`
    : `## Catalog refresh\n`;

  const body = [
    header,
    "### Summary",
    "",
    renderRegionTable(regionRows),
    "",
    ...regionSections.map((s) => s.markdown),
  ].join("\n");

  await writeFile(output, body);
  console.log(`\nWrote ${output} (${body.length} bytes)`);

  if (failures.length) process.exit(1);
}

await main();
