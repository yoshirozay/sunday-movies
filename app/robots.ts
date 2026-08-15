import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /api/* doesn't need crawling — it serves JSON for the random modal
        // and would just chew through crawl budget for nothing.
        disallow: "/api/",
      },
    ],
    sitemap: "https://sundaymovies.io/sitemap.xml",
    host: "https://sundaymovies.io",
  };
}
