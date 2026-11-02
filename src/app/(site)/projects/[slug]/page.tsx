import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AtAGlance, MoreWork, readStory, StoryHeader } from "@/components/case-study";
import storyStyles from "@/components/case-study.module.css";
import { JsonLd } from "@/components/json-ld";
import { MarkdocContent } from "@/components/markdoc";
import { articleLd } from "@/lib/article-ld";
import { getProjects, getProject, getSite } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";

export async function generateStaticParams() {
  return (await getProjects()).map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps<"/projects/[slug]">) {
  const { slug } = await params;
  const entry = await getProject(slug);
  if (!entry) return {};
  return buildMetadata({
    title: entry.title,
    summary: entry.summary,
    seo: entry.seo,
    path: `/projects/${slug}`,
    image: entry.cover,
    type: "article",
    publishedTime: entry.date,
  });
}

// Every slug is prerendered; the boundary only covers the shell for unknown slugs.
export default function Page({ params }: PageProps<"/projects/[slug]">) {
  return (
    <Suspense>
      <ProjectPage params={params} />
    </Suspense>
  );
}

async function ProjectPage({ params }: Pick<PageProps<"/projects/[slug]">, "params">) {
  const { slug } = await params;
  const [entry, all, site] = await Promise.all([getProject(slug), getProjects(), getSite()]);
  if (!entry) notFound();
  const { body, sections, minutes } = readStory(entry.body);
  // the next three in the list's order, wrapping round, so every page leads on somewhere
  const at = all.findIndex((p) => p.slug === slug);
  const more = [1, 2, 3].map((k) => all[(at + k) % all.length]).filter((p) => p && p.slug !== slug);

  return (
    <article className={storyStyles.story}>
      <JsonLd data={await articleLd({ type: "CreativeWork", ...entry, path: `/projects/${slug}` })} />
      <StoryHeader story={entry} minutes={minutes} author={site.name} />
      <AtAGlance story={entry} sections={sections} />
      <MarkdocContent tree={body} variant="story" />
      <MoreWork items={more} />
    </article>
  );
}
