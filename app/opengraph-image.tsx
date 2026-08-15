import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "sunday movies — what's actually streaming in Canada";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Bundled latin-subset Inter (~22 KB each). Local read = no runtime network
// dependency, no rate limit risk, fully offline-buildable.
async function loadFont(file: string) {
  return readFile(path.join(process.cwd(), "public/fonts", file));
}

export default async function Image() {
  const [interBold, interRegular] = await Promise.all([
    loadFont("Inter-Bold.woff"),
    loadFont("Inter-Regular.woff"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#000000",
          color: "#ffffff",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: 80,
          fontFamily: "Inter",
        }}
      >
        {/* Popcorn mark — same composition as the favicon */}
        <svg
          width="160"
          height="160"
          viewBox="0 0 64 64"
          style={{ marginBottom: 36 }}
        >
          <circle cx="22" cy="22" r="7" fill="#ffffff" />
          <circle cx="32" cy="14" r="8" fill="#ffffff" />
          <circle cx="42" cy="22" r="7" fill="#ffffff" />
          <circle cx="28" cy="28" r="6" fill="#ffffff" />
          <circle cx="36" cy="28" r="6" fill="#ffffff" />
          <rect x="15" y="32" width="34" height="4" fill="#ffffff" />
          <path d="M 18 36 L 46 36 L 42 56 L 22 56 Z" fill="#ffffff" />
          <rect x="22" y="36" width="5" height="20" fill="#e11d48" />
          <rect x="37" y="36" width="5" height="20" fill="#e11d48" />
        </svg>

        {/* Display heading — tight per Framer spec */}
        <div
          style={{
            fontSize: 132,
            fontWeight: 700,
            letterSpacing: "-0.055em",
            lineHeight: 0.9,
            whiteSpace: "nowrap",
            display: "flex",
          }}
        >
          the best movies
        </div>

        {/* Subhead — Framer-spec Inter with tight tracking, silver on black. */}
        <div
          style={{
            fontSize: 44,
            fontWeight: 400,
            color: "#a6a6a6",
            marginTop: 32,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            display: "flex",
          }}
        >
          filter for your streaming service
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Inter",
          data: interBold,
          weight: 700,
          style: "normal",
        },
        {
          name: "Inter",
          data: interRegular,
          weight: 400,
          style: "normal",
        },
      ],
    },
  );
}
