import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/site/:path*",
        destination: "/:path*",
      },
    ];
  },
};

export default nextConfig;
