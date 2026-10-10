import type { MetadataRoute } from "next";
// Private company workspace: keep every page out of search engines.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
