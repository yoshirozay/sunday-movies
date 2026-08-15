"use client";

import Image from "next/image";
import { tmdbImageLoader } from "@/lib/tmdb-image-loader";

// Wrap next/image so we can pass the loader function from a server-rendered
// page without hitting React's "functions can't cross the RSC boundary" rule.
export function CanonicalBackdrop({ src }: { src: string }) {
  return (
    <Image
      src={src}
      alt=""
      fill
      priority
      sizes="100vw"
      loader={tmdbImageLoader}
      className="object-cover"
    />
  );
}
