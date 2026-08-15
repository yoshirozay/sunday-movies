import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AnalyticsConfig } from "./_components/analytics-config";
import { AnalyticsWrapper } from "./_components/analytics-wrapper";
import { MovieModalProvider } from "./_components/movie-modal-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  axes: ["opsz"],
});

// metadataBase makes any relative URLs in metadata (OG images, canonical
// alternates) resolve to the production canonical. .ca redirects here at the
// Vercel domain layer so this is the single source of truth.
export const metadata: Metadata = {
  metadataBase: new URL("https://sundaymovies.io"),
  title: {
    default: "sunday movies — top-rated films streaming on Netflix, Disney+ & more",
    template: "%s | sunday movies",
  },
  description:
    "Find the best movies and TV streaming on Netflix, Prime Video, Disney+, Crave, Max, Hulu, Paramount+, Peacock and Apple TV+. Filtered to what you can actually watch.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      style={{ colorScheme: "dark" }}
    >
      <body className="min-h-full flex flex-col font-sans">
        <MovieModalProvider>{children}</MovieModalProvider>
        <AnalyticsWrapper />
        <AnalyticsConfig />
      </body>
    </html>
  );
}
