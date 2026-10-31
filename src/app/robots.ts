import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const url = await getSiteUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/keystatic", "/api/"] },
    sitemap: `${url}/sitemap.xml`,
    host: url,
  };
}
