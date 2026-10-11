import type { MetadataRoute } from "next";
// Private company workspace: only the public privacy and terms pages may be crawled.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: ["/privacy", "/terms"], disallow: "/" }] };
}
