import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SERVICE_LABEL, posterUrl } from "@/lib/types";
import { getRegion } from "@/lib/region";
import { findTitle } from "@/lib/title-lookup";
import { CanonicalTitle } from "@/app/_components/canonical-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tconst: string }>;
}): Promise<Metadata> {
  const { tconst } = await params;
  const region = await getRegion();
  const result = await findTitle(tconst, region);
  if (!result || result.movie.kind !== "tv") {
    return { title: "Not found — sunday movies" };
  }
  const { movie } = result;
  const yearLabel = movie.year ? ` (${movie.year})` : "";
  const services = (movie.availableOn ?? [])
    .map((s) => SERVICE_LABEL[s])
    .join(", ");
  const where = services ? `Stream on ${services}` : "Where to watch";
  const description =
    movie.overview?.trim().slice(0, 160) ??
    `${movie.title}${yearLabel}. ${where}.`;
  const image = posterUrl(movie.posterPath, "w780");
  return {
    title: `${movie.title}${yearLabel} — ${where}`,
    description,
    alternates: { canonical: `/t/${tconst}` },
    openGraph: {
      title: `${movie.title}${yearLabel}`,
      description,
      images: image ? [{ url: image }] : undefined,
      url: `https://sundaymovies.io/t/${tconst}`,
      type: "video.tv_show",
    },
  };
}

export default async function TvPage({
  params,
}: {
  params: Promise<{ tconst: string }>;
}) {
  const { tconst } = await params;
  const region = await getRegion();
  const result = await findTitle(tconst, region);
  if (!result) notFound();
  if (result.movie.kind !== "tv") notFound();
  return (
    <CanonicalTitle
      movie={result.movie}
      region={region}
      foundIn={result.foundIn}
    />
  );
}
