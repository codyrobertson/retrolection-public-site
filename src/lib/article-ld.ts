import { getSite } from "./content";
import { getSiteUrl } from "./seo";

/** schema.org data for a long-form entry. */
export async function articleLd(entry: {
  type: "BlogPosting" | "CreativeWork";
  title: string;
  summary?: string | null;
  date?: string | null;
  updated?: string | null;
  cover?: string | null;
  path: string;
}) {
  const [site, url] = await Promise.all([getSite(), getSiteUrl()]);
  return {
    "@context": "https://schema.org",
    "@type": entry.type,
    headline: entry.title,
    name: entry.title,
    description: entry.summary || undefined,
    datePublished: entry.date || undefined,
    dateModified: entry.updated || entry.date || undefined,
    image: entry.cover ? new URL(entry.cover, url).href : undefined,
    url: `${url}${entry.path}`,
    mainEntityOfPage: `${url}${entry.path}`,
    author: { "@type": "Person", name: site.name, url },
  };
}
