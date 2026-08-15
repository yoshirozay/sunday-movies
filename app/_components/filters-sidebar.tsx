"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import {
  CERTIFICATIONS,
  KIND_LABEL,
  KINDS,
  REGION_SERVICES,
  REGIONS,
  SERVICE_LABEL,
  SERVICE_LOGO,
  type Certification,
  type Kind,
  type Region,
  type StreamingService,
} from "@/lib/types";
import { setRegion } from "@/lib/region-actions";
import { setServices } from "@/lib/services-actions";
import { WatchlistLink } from "./watchlist-link";

// Which ratings to expose in UI (NC-17 is rare enough to hide, NR = no US cert)
const RATING_OPTIONS: Certification[] = ["G", "PG", "PG-13", "R"];

const REGION_FLAG: Record<Region, string> = {
  ca: "/flags/ca.svg",
  us: "/flags/us.svg",
  gb: "/flags/gb.svg",
  au: "/flags/au.svg",
};

const REGION_NAME: Record<Region, string> = {
  ca: "Canada",
  us: "United States",
  gb: "United Kingdom",
  au: "Australia",
};

// Services where we have a real SVG wordmark in public/logos. Services
// without SVGs render their text label instead of a broken-image icon.
const SERVICES_WITH_LOGOS = new Set<StreamingService>([
  "netflix",
  "prime",
  "hulu",
  "hbo",
  "paramount",
  "disney",
  "crave",
  "peacock",
  "now",
  "stan",
  "hbomax",
  "apple",
]);

// Per-service logo height tweaks. Wider wordmarks stay near 14px;
// stacked or squarer marks (Disney+, HBO Max 2025) render taller so the
// on-screen widths optically balance.
const LOGO_HEIGHT: Record<StreamingService, number> = {
  netflix: 14,
  prime: 14,
  hulu: 14,
  hbo: 18, // 2025 HBO Max is stacked HBO + Max — taller than wordmarks but lighter than Disney+
  paramount: 14,
  disney: 22,
  // The new Crave wordmark is much wider (5.65:1) than the old CraveTV
  // version was, so trim the height to keep the on-screen width in line
  // with the other service marks.
  crave: 11,
  peacock: 16,
  now: 16,
  stan: 14,
  hbomax: 18, // 2025 HBO Max stacked mark — same height as `hbo`
  apple: 16,
};

function parseMulti<T extends string>(
  raw: string | null,
  valid: readonly T[],
): T[] {
  if (!raw) return [];
  const validSet = new Set<string>(valid);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => validSet.has(s));
}

// Read the `services` cookie client-side. Sidebar mirrors page.tsx's
// server-side fallback: when the URL has no ?services= param, the active
// selection comes from the cookie. Without this, the sidebar UI would
// disagree with what the page actually rendered.
function readServicesCookie(
  validServices: readonly StreamingService[],
): StreamingService[] {
  if (typeof document === "undefined") return [];
  const match = document.cookie.match(/(?:^|;\s*)services=([^;]+)/);
  if (!match) return [];
  return parseMulti<StreamingService>(
    decodeURIComponent(match[1]),
    validServices,
  );
}

export function FiltersSidebar({ region }: { region: Region }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [, startRegionTransition] = useTransition();
  const services_for_region = REGION_SERVICES[region];

  const onRegionChange = (next: Region) => {
    if (next === region) return;
    startRegionTransition(async () => {
      await setRegion(next);
    });
  };

  // Default kind selection: movies-only when the param is absent. If the
  // user explicitly clears the param (?kinds=), they get an empty selection
  // that matches nothing.
  const kinds = useMemo<Kind[]>(() => {
    const raw = searchParams.get("kinds");
    if (raw === null) return ["movie"];
    return parseMulti<Kind>(raw, KINDS);
  }, [searchParams]);
  const services = useMemo(() => {
    const raw = searchParams.get("services");
    if (raw === null) return readServicesCookie(services_for_region);
    return parseMulti<StreamingService>(raw, services_for_region);
  }, [searchParams, services_for_region]);
  const ratings = useMemo(
    () =>
      parseMulti<Certification>(searchParams.get("ratings"), CERTIFICATIONS),
    [searchParams],
  );
  // English-only is the implicit default; only the opt-out (`?lang=all`)
  // serializes into the URL so default views stay clean.
  const englishOnly = searchParams.get("lang") !== "all";

  const push = useCallback(
    (
      nextKinds: Kind[],
      nextServices: StreamingService[],
      nextRatings: Certification[],
      nextEnglishOnly: boolean,
    ) => {
      const params = new URLSearchParams();
      // Only write `kinds` when it differs from the default (movies-only).
      // This keeps default URLs clean (`/` not `/?kinds=movie`) so bookmarks
      // and shares don't accidentally pin filter state. Explicit empty
      // selection (`?kinds=`) still serializes for the "show nothing" case.
      const isDefault = nextKinds.length === 1 && nextKinds[0] === "movie";
      if (!isDefault) params.set("kinds", nextKinds.join(","));
      if (nextServices.length) params.set("services", nextServices.join(","));
      if (nextRatings.length) params.set("ratings", nextRatings.join(","));
      if (!nextEnglishOnly) params.set("lang", "all");
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router],
  );

  const toggleKind = (k: Kind) => {
    const next = kinds.includes(k)
      ? kinds.filter((x) => x !== k)
      : [...kinds, k];
    push(next, services, ratings, englishOnly);
  };

  const toggleService = (s: StreamingService) => {
    const next = services.includes(s)
      ? services.filter((x) => x !== s)
      : [...services, s];
    push(kinds, next, ratings, englishOnly);
    // Sync cookie so the server's bare-URL fallback matches the user's
    // current selection (otherwise clearing here leaves the cookie stale and
    // a subsequent navigation re-applies the old filter).
    void setServices(next);
  };

  const toggleRating = (r: Certification) => {
    const next = ratings.includes(r)
      ? ratings.filter((x) => x !== r)
      : [...ratings, r];
    push(kinds, services, next, englishOnly);
  };

  const toggleEnglishOnly = () => {
    push(kinds, services, ratings, !englishOnly);
  };

  // Clear: revert to default (movies-only, English-only, no other filters)
  const clearAll = () => {
    push(["movie"], [], [], true);
    void setServices([]);
  };

  const isDefaultKinds = kinds.length === 1 && kinds[0] === "movie";
  const hasActive =
    !isDefaultKinds ||
    services.length > 0 ||
    ratings.length > 0 ||
    !englishOnly;

  return (
    <aside
      className="rounded-[15px] bg-[color:var(--near-black)]/50 p-5"
      style={{
        boxShadow: "rgba(0, 0, 0, 0.6) 0px 0px 0px 1px",
        opacity: isPending ? 0.7 : 1,
        transition: "opacity 120ms ease",
      }}
    >
      <WatchlistLink />
      <header className="mb-4 flex items-baseline justify-between">
        <h3
          className="text-[11px] font-medium uppercase text-[color:var(--silver)]"
          style={{ letterSpacing: "0.15em" }}
        >
          Filters
        </h3>
        {hasActive && (
          <button
            onClick={clearAll}
            className="text-[11px] text-[color:var(--silver)] hover:text-white"
          >
            clear
          </button>
        )}
      </header>

      <Group label="Streaming">
        <div className="flex flex-col gap-1">
          {services_for_region.map((s) => (
            <Check
              key={s}
              checked={services.includes(s)}
              onToggle={() => toggleService(s)}
            >
              {SERVICES_WITH_LOGOS.has(s) ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={SERVICE_LOGO[s]}
                  alt={SERVICE_LABEL[s]}
                  style={{ height: LOGO_HEIGHT[s], width: "auto" }}
                />
              ) : (
                <span
                  className="text-[13px] font-medium text-white"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {SERVICE_LABEL[s]}
                </span>
              )}
            </Check>
          ))}
        </div>
      </Group>

      <Group label="Region">
        <div className="flex gap-1.5" role="radiogroup" aria-label="Region">
          {REGIONS.map((r) => {
            const checked = region === r;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={REGION_NAME[r]}
                onClick={() => onRegionChange(r)}
                className={
                  "inline-flex items-center justify-center rounded-full px-2.5 py-1.5 transition-colors " +
                  (checked
                    ? "bg-white/[0.12]"
                    : "bg-white/[0.04] opacity-60 hover:bg-white/[0.08] hover:opacity-100")
                }
                style={{
                  boxShadow: checked
                    ? "inset 0 0 0 1px rgba(255, 255, 255, 0.5)"
                    : "inset 0 0 0 1px rgba(255, 255, 255, 0.06)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={REGION_FLAG[r]}
                  alt={REGION_NAME[r]}
                  className="h-3 w-[18px] rounded-[2px] object-cover ring-1 ring-white/20"
                />
              </button>
            );
          })}
        </div>
      </Group>

      <Group label="Type">
        <div className="flex flex-col gap-1">
          {KINDS.map((k) => (
            <Check
              key={k}
              checked={kinds.includes(k)}
              onToggle={() => toggleKind(k)}
            >
              <span
                className="text-[13px] font-medium text-white"
                style={{ letterSpacing: "-0.01em" }}
              >
                {KIND_LABEL[k]}
              </span>
            </Check>
          ))}
        </div>
      </Group>

      <Group label="Language">
        <div className="flex flex-col gap-1">
          <Check checked={englishOnly} onToggle={toggleEnglishOnly}>
            <span
              className="text-[13px] font-medium text-white"
              style={{ letterSpacing: "-0.01em" }}
            >
              English only
            </span>
          </Check>
        </div>
      </Group>

      <Group label="Movie rating">
        <div className="flex flex-col gap-1">
          {RATING_OPTIONS.map((r) => (
            <Check
              key={r}
              checked={ratings.includes(r)}
              onToggle={() => toggleRating(r)}
            >
              <span
                className="font-mono text-[13px] tabular-nums text-white"
                style={{ letterSpacing: "-0.01em" }}
              >
                {r}
              </span>
            </Check>
          ))}
        </div>
      </Group>
    </aside>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <h4
        className="mb-2 text-[10px] font-medium uppercase text-white/50"
        style={{ letterSpacing: "0.15em" }}
      >
        {label}
      </h4>
      {children}
    </section>
  );
}

function Check({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-[8px] px-2 py-1.5 transition-colors hover:bg-white/[0.04]">
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] transition-colors"
        style={{
          background: checked
            ? "var(--framer-blue)"
            : "rgba(255, 255, 255, 0.1)",
          boxShadow: checked ? "none" : "inset 0 0 0 1px rgba(255,255,255,0.15)",
        }}
      >
        {checked && (
          <svg
            viewBox="0 0 10 10"
            className="h-2.5 w-2.5 fill-none stroke-white"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="1.5,5 4,7.5 8.5,2.5" />
          </svg>
        )}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={onToggle}
      />
      <span className="flex-1">{children}</span>
    </label>
  );
}
