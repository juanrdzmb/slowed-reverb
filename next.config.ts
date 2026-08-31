import type { NextConfig } from "next";

const basePath = process.env.BASE_PATH || (process.env.GITHUB_ACTIONS ? "/slowed-reverb" : "");

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

