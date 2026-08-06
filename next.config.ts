import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Fotos de imóveis vêm de vários sites (Maxwork, Idealista, etc.) via
    // scrapers — o domínio não é conhecido antecipadamente.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
