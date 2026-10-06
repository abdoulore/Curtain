import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Show posters live in the project's public Vercel Blob store.
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com", pathname: "/shows/**" }],
  },
};

export default nextConfig;
