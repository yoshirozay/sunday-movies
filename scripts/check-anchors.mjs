// Anchor smoke-test: assert a few known-good facts about the catalog after a
// refresh. Catches silent regressions (e.g. a service-wide drop from the TMDB
// rate-limit bug, or a Crave deep link going dead) before they ship.
//
// Anchors live in scripts/anchors.json. Exits non-zero if any anchor fails, so
// it can gate a refresh:  npm run fetch-data -- --region=ca && node scripts/check-anchors.mjs --region=ca
//
// Usage: node scripts/check-anchors.mjs --region=ca|us|gb|au   (default: ca)

import { readFile } from "node:fs/promises";
import path from "node:path";

function parseRegion() {
  const arg = process.argv.find((a) => a.startsWith("--region="));
  const r = arg ? arg.slice("--region=".length) : "ca";
  if (!["ca", "us", "gb", "au"].includes(r)) {
    console.error(`Invalid --region: ${r}. Use ca, us, gb, or au.`);
    process.exit(2);
  }
  return r;
}

const REGION = parseRegion();

async function main() {
  const anchorsPath = path.join(process.cwd(), "scripts", "anchors.json");
  const anchors = JSON.parse(await readFile(anchorsPath, "utf8"));
  const list = anchors[REGION] ?? [];
  if (list.length === 0) {
    console.log(`No anchors defined for ${REGION.toUpperCase()} — skipping.`);
    return;
  }

  const file = path.join(process.cwd(), "public", `movies-${REGION}.json`);
  const titles = JSON.parse(await readFile(file, "utf8"));
  const byId = new Map(titles.map((t) => [t.id, t]));

  const failures = [];
  for (const a of list) {
    const t = byId.get(a.id);
    if (!t) {
      failures.push(`${a.title} (${a.id}): NOT in catalog`);
      console.log(`  ✗ ${a.title} — missing from catalog`);
      continue;
    }
    const on = new Set(t.availableOn ?? []);
    const links = t.streamingLinks ?? {};
    const problems = [];
    for (const svc of a.mustBeOn ?? []) {
      if (!on.has(svc)) problems.push(`not on ${svc} (availableOn=${[...on].join(",") || "none"})`);
    }
    for (const svc of a.mustHaveLink ?? []) {
      if (!on.has(svc)) problems.push(`not on ${svc}`);
      else if (!links[svc]) problems.push(`no deep link for ${svc} (dead link)`);
    }
    if (problems.length) {
      failures.push(`${a.title} (${a.id}): ${problems.join("; ")}`);
      console.log(`  ✗ ${a.title} — ${problems.join("; ")}`);
    } else {
      console.log(`  ✓ ${a.title}`);
    }
  }

  console.log(
    `\n${list.length - failures.length}/${list.length} anchors passed (${REGION.toUpperCase()}).`,
  );
  if (failures.length) {
    console.error(`\n✗ ${failures.length} anchor(s) FAILED — investigate before committing:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("✓ All anchors passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
