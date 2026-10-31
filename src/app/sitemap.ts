import type { MetadataRoute } from "next";
import { getCaseStudies, getExperiments, getPages, getPosts } from "@/lib/content";
import { getSiteUrl } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [url, work, experiments, posts, pages] = await Promise.all([
    getSiteUrl(),
    getCaseStudies(),
    getExperiments(),
    getPosts(),
    getPages(),
  ]);

  const entry = (path: string, lastModified?: string | null) => ({
    url: `${url}${path}`,
    ...(lastModified && { lastModified }),
  });

  return [
    entry("/"),
    entry("/work"),
    entry("/experiments"),
    entry("/writing"),
    entry("/resume"),
    ...pages.filter((p) => !p.seo.noindex).map((p) => entry(`/${p.slug}`)),
    ...work.filter((w) => !w.seo.noindex).map((w) => entry(`/work/${w.slug}`, w.date)),
    ...experiments.filter((e) => !e.seo.noindex).map((e) => entry(`/experiments/${e.slug}`, e.date)),
    ...posts.filter((p) => !p.seo.noindex).map((p) => entry(`/writing/${p.slug}`, p.updated || p.date)),
  ];
}
