import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui"],
  // Ships a native binary per platform; bundling it breaks the dynamic
  // require it uses to load that binary, so it must be required directly by
  // Node at runtime instead.
  serverExternalPackages: ["@resvg/resvg-js"],
  // Next.js blocks dev-server requests (JS/CSS chunks, HMR, etc.) whose
  // Origin isn't localhost. Without this, opening the app from the LAN IP
  // (needed to scan a generated QR from a phone) loads a broken shell.
  allowedDevOrigins: ["192.168.3.70", "192.168.3.*", "192.168.1.3", "192.168.1.*"],
}

export default nextConfig
