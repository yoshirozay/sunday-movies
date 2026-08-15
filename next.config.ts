import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Pin Turbopack to this project so it doesn't pick up a stray
  // package-lock.json from a parent directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
