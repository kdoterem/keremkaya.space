import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const withMDX = createMDX({});

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  async redirects() {
    return [
      { source: "/art", destination: "/kismet", permanent: true },
      { source: "/writing/mimilat", destination: "/writing/thank-you", permanent: true },
    ];
  },
};

export default withMDX(nextConfig);
