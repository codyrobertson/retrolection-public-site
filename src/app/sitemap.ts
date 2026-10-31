import type { MetadataRoute } from "next";
import { getArtifacts, getExperiments, getProjects, getPages, getPosts } from "@/lib/content";
import { getSiteUrl } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [url, projects, experiments, posts, artifacts, pages] = await Promise.all([
    getSiteUrl(),
    getProjects(),
    getExperiments(),
    getPosts(),
    getArtifacts(),
    getPages(),
  ]);

  const entry = (path: string, lastModified?: string | null) => ({
    url: `${url}${path}`,
    ...(lastModified && { lastModified }),
  });

  return [
    entry("/"),
    entry("/projects"),
    entry("/experiments"),
    entry("/writing"),
    entry("/artifacts"),
    entry("/resume"),
    ...pages.filter((p) => !p.seo.noindex).map((p) => entry(`/${p.slug}`)),
    ...projects.filter((p) => !p.seo.noindex).map((p) => entry(`/projects/${p.slug}`, p.date)),
    ...experiments.filter((e) => !e.seo.noindex).map((e) => entry(`/experiments/${e.slug}`, e.date)),
    ...posts.filter((p) => !p.seo.noindex).map((p) => entry(`/writing/${p.slug}`, p.updated || p.date)),
    ...artifacts.filter((a) => !a.seo.noindex).map((a) => entry(`/artifacts/${a.slug}`, a.date)),
  ];
}
