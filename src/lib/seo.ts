import type { Metadata } from "next";
import { getSite } from "./content";

/** Absolute site origin. CMS value wins, then Vercel's production domain, then localhost. */
export async function getSiteUrl() {
  const site = await getSite();
  const fromEnv = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000";
  return (site.url || fromEnv).replace(/\/$/, "");
}

type PageSeo = {
  /** Visible page title (used when no SEO override). */
  title?: string;
  /** Fallback description (usually the entry summary). */
  summary?: string | null;
  seo?: { title?: string; description?: string; noindex?: boolean } | null;
  path: string;
  image?: string | null;
  type?: "website" | "article";
  publishedTime?: string | null;
  modifiedTime?: string | null;
};

export async function buildMetadata(page: PageSeo): Promise<Metadata> {
  const site = await getSite();
  const title = page.seo?.title || page.title;
  const description = page.seo?.description || page.summary || site.description || undefined;
  const images = page.image ? [{ url: page.image }] : undefined;

  return {
    title,
    description,
    alternates: { canonical: page.path },
    robots: page.seo?.noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: page.type ?? "website",
      url: page.path,
      title: title ?? site.title,
      description,
      siteName: site.name,
      ...(images && { images }),
      ...(page.type === "article" && {
        publishedTime: page.publishedTime ?? undefined,
        modifiedTime: page.modifiedTime ?? undefined,
        authors: [site.name],
      }),
    },
    twitter: { card: "summary_large_image", title: title ?? site.title, description },
  };
}
