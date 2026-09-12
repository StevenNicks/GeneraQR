import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui"],
  // Next.js blocks dev-server requests (JS/CSS chunks, HMR, etc.) whose
  // Origin isn't localhost. Without this, opening the app from the LAN IP
  // (needed to scan a generated QR from a phone) loads a broken shell.
  allowedDevOrigins: ["192.168.3.70", "192.168.3.*"],
}

export default nextConfig
