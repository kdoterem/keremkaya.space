import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const withMDX = createMDX({});

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  async redirects() {
    return [
      { source: "/art", destination: "/kismet", permanent: true },
      { source: "/writing/mimilat", destination: "/writing/thank-you", permanent: true },
      { source: "/terrain", destination: "/writing", permanent: true },
      // SCANS lived at /answers (repurposed from the old Q&A listing) before
      // moving to its own /scans route — /answers/[slug] still serves the
      // old Q&A pages directly, untouched, so this only redirects the exact
      // index path, not everything under it.
      { source: "/answers", destination: "/scans", permanent: true },
    ];
  },
};

export default withMDX(nextConfig);
