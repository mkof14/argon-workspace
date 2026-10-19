/** @type {import('next').NextConfig} */
const supabase = "https://*.supabase.co";
// a non-Supabase-cloud project URL (the isolated test stack) is allowed too
const own = (() => { try { const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || ""); return u.hostname.endsWith(".supabase.co") ? "" : u.origin; } catch { return ""; } })();
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob: https://workspace.agron1.com ${supabase}${own ? ` ${own}` : ""}`,
  `media-src 'self' blob: ${supabase}`,
  `connect-src 'self' ${supabase} wss://*.supabase.co${own ? ` ${own}` : ""}`,
  `frame-src 'self' blob: data: ${supabase}${own ? ` ${own}` : ""}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(own.startsWith("http://") ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const security = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig = {
  reactStrictMode: true,
  // the isolated test stack builds into its own folder, so the demo and production builds are untouched
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The user guide PDFs are read by /api/guide (signed-in staff only), so they ship with that function
  outputFileTracingIncludes: { "/api/guide": ["./guide/*.pdf", "./guide/manifest.json"] },
  poweredByHeader: false,
  // Title, description and preview tags go into <head> for every visitor (not streamed later), so link previews and audits see them
  htmlLimitedBots: /.*/,
  async headers() {
    return [
      { source: "/:path*", headers: security },
      // Logos and email images never change between releases: cache for a week
      { source: "/:file(logo-full.webp|logo-mark.webp)", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
      { source: "/email/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }, { key: "Access-Control-Allow-Origin", value: "*" }] },
    ];
  },
};
export default nextConfig;
