"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  REGION_SERVICES,
  REGIONS,
  SERVICE_LABEL,
  SERVICE_LOGO,
  type Region,
  type StreamingService,
} from "@/lib/types";
import { setRegion } from "@/lib/region-actions";
import { setServices } from "@/lib/services-actions";
import { track } from "@/lib/analytics";

// First-visit popup: pick streaming platforms so the home view filters
// out everything you can't actually watch. Persisted server-side via the
// `services` cookie so the very first render of subsequent visits is
// already filtered — no client-side router.replace flash. Dismissing
// without picking does NOT persist — it'll re-open next visit.

// Legacy localStorage keys — read once during migration so existing users
// don't lose their saved selection. Cleared after migration.
const LEGACY_ONBOARDED_KEY = "services-onboarded";
const LEGACY_SELECTION_KEY = "services-selected";

// Per-service logo height tweaks to match the optical sizing used in
// filters-sidebar.tsx — Disney+ has a much squarer SVG so it needs more
// height to look the same width as the others. ~+2px vs the sidebar
// because the modal renders larger.
const LOGO_HEIGHT: Record<StreamingService, number> = {
  netflix: 16,
  prime: 16,
  hulu: 16,
  hbo: 20, // 2025 HBO Max is stacked HBO + max — taller than wordmarks
  paramount: 16,
  disney: 24,
  crave: 13,
  peacock: 18,
  now: 18,
  stan: 16,
  hbomax: 20, // matches `hbo` — same 2025 stacked mark
  apple: 18,
};

const REGION_FLAG: Record<Region, string> = {
  ca: "🇨🇦",
  us: "🇺🇸",
  gb: "🇬🇧",
  au: "🇦🇺",
};

const REGION_LABEL_FULL: Record<Region, string> = {
  ca: "Canada",
  us: "United States",
  gb: "United Kingdom",
  au: "Australia",
};

export function OnboardingModal({
  region: initialRegion,
  hasOnboarded,
}: {
  region: Region;
  hasOnboarded: boolean;
}) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [selected, setSelected] = useState<Set<StreamingService>>(new Set());
  // Local region state so users can correct geo-misdetection in the modal
  // before picking services. Persisted via setRegion server action on Continue.
  const [selectedRegion, setSelectedRegion] = useState<Region>(initialRegion);
  const [, startTransition] = useTransition();
  const services_for_region = REGION_SERVICES[selectedRegion];

  const onRegionChange = (next: Region) => {
    setRegionOpen(false);
    if (next === selectedRegion) return;
    setSelectedRegion(next);
    // Clear service selections — service lists differ across regions and
    // mixed selections would be confusing on submit.
    setSelected(new Set());
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hasOnboarded) return;

    // One-time migration for users who onboarded before we moved to a
    // server-side cookie. Silently lift their saved selection over so they
    // don't see the modal again (or lose their picks). Safe to delete this
    // block once existing users have all migrated.
    const legacyOnboarded =
      window.localStorage.getItem(LEGACY_ONBOARDED_KEY) === "1";
    if (legacyOnboarded) {
      const legacy = window.localStorage.getItem(LEGACY_SELECTION_KEY);
      const services = legacy
        ? (legacy
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean) as StreamingService[])
        : [];
      window.localStorage.removeItem(LEGACY_ONBOARDED_KEY);
      window.localStorage.removeItem(LEGACY_SELECTION_KEY);
      startTransition(async () => {
        await setServices(services);
      });
      return;
    }

    if (searchParams.get("services")) return; // first visit via shared filtered link
    setOpen(true);
  }, [hasOnboarded, searchParams]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const toggle = (s: StreamingService) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const onContinue = () => {
    const services = Array.from(selected);
    track("onboarded", {
      count: services.length,
      services: services.join(","),
      region: selectedRegion,
    });
    // Persist server-side. setServices revalidates the layout, so the next
    // render reflects the new filter (and the cookie pre-fills future visits).
    startTransition(async () => {
      if (selectedRegion !== initialRegion) {
        await setRegion(selectedRegion);
      }
      await setServices(services);
    });
    setOpen(false);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/85"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
        <div
          role="dialog"
          aria-label="Select your streaming platforms"
          className="pointer-events-auto w-full max-w-[440px] overflow-hidden rounded-[20px] p-7 sm:rounded-[24px] sm:p-8"
          style={{
            background: "#161616",
            boxShadow:
              "rgba(0, 0, 0, 0.6) 0px 30px 60px, rgba(0, 0, 0, 0.4) 0px 10px 30px",
            maxHeight: "92vh",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              className="text-[26px] font-semibold leading-[1.1] text-white sm:text-[28px]"
              style={{ letterSpacing: "-0.03em" }}
            >
              Which platforms do you have?
            </h2>
            <div className="relative shrink-0">
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={regionOpen}
                aria-label={`Region: ${REGION_LABEL_FULL[selectedRegion]}`}
                onClick={() => setRegionOpen(!regionOpen)}
                className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[13px] text-white/85 transition-colors hover:bg-white/[0.1]"
                style={{
                  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
                }}
              >
                <span aria-hidden className="text-[16px] leading-none">
                  {REGION_FLAG[selectedRegion]}
                </span>
                <Chevron open={regionOpen} />
              </button>
              {regionOpen && (
                <>
                  <div
                    className="fixed inset-0 z-[1]"
                    onClick={() => setRegionOpen(false)}
                    aria-hidden
                  />
                  <ul
                    role="listbox"
                    aria-label="Region"
                    className="absolute right-0 top-full z-[2] mt-1.5 min-w-[160px] overflow-hidden rounded-[12px] py-1"
                    style={{
                      background: "#1f1f1f",
                      boxShadow:
                        "rgba(0, 0, 0, 0.5) 0px 10px 30px, inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    {REGIONS.map((r) => {
                      const checked = selectedRegion === r;
                      return (
                        <li key={r}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={checked}
                            onClick={() => onRegionChange(r)}
                            className={
                              "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors " +
                              (checked
                                ? "text-white"
                                : "text-white/75 hover:bg-white/[0.06] hover:text-white")
                            }
                            style={{ letterSpacing: "-0.01em" }}
                          >
                            <span aria-hidden className="text-[16px] leading-none">
                              {REGION_FLAG[r]}
                            </span>
                            <span>{REGION_LABEL_FULL[r]}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
          <p
            className="mt-2 text-[13px] text-[color:var(--silver)]"
            style={{ letterSpacing: "-0.01em" }}
          >
            We&apos;ll only show you titles you can actually watch.
          </p>

          <ul className="mt-6 flex flex-col gap-2">
            {services_for_region.map((s) => {
              const checked = selected.has(s);
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => toggle(s)}
                    aria-pressed={checked}
                    className={
                      "flex w-full items-center justify-between rounded-full px-5 py-3.5 text-left transition-colors " +
                      (checked
                        ? "bg-white/[0.12]"
                        : "bg-white/[0.04] hover:bg-white/[0.08]")
                    }
                    style={{
                      boxShadow: checked
                        ? "inset 0 0 0 1px rgba(255, 255, 255, 0.5)"
                        : "inset 0 0 0 1px rgba(255, 255, 255, 0.06)",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={SERVICE_LOGO[s]}
                      alt={SERVICE_LABEL[s]}
                      style={{ height: LOGO_HEIGHT[s], width: "auto" }}
                    />
                    <span
                      aria-hidden
                      className={
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] transition-colors " +
                        (checked ? "bg-white" : "bg-white/[0.08]")
                      }
                    >
                      {checked && <CheckMark />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={onContinue}
            disabled={selected.size === 0}
            className={
              "mt-7 w-full rounded-full bg-white px-5 py-3.5 text-[14px] font-medium text-black transition-opacity " +
              (selected.size === 0
                ? "cursor-not-allowed opacity-40"
                : "hover:bg-white/90")
            }
            style={{ letterSpacing: "-0.01em" }}
          >
            Continue
          </button>
        </div>
      </div>
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={
        "h-2.5 w-2.5 transition-transform " + (open ? "rotate-180" : "")
      }
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3,4.5 6,7.5 9,4.5" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-2.5 w-2.5"
      fill="none"
      stroke="black"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="2,6.5 5,9.5 10,3" />
    </svg>
  );
}
