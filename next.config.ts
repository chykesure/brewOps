import type { NextConfig } from "next";

const securityHeaders = [
  // Clickjacking: the app must never be framed by another site
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Only the app itself may use the camera & GPS; no other origins
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // Practical CSP: everything self-hosted, no third-party script/object sources.
  // Inline styles/scripts stay allowed (Next.js runtime + styled JSX).
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  /* keep the production look — no framework dev badge on screen */
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
