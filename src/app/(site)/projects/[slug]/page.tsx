import { Suspense } from "react";
import { notFound } from "next/navigation";
import { EntryHeader } from "@/components/entry-header";
import { JsonLd } from "@/components/json-ld";
import { MarkdocContent } from "@/components/markdoc";
import { articleLd } from "@/lib/article-ld";
import { getProjects, getProject } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";
import { disciplineLabel, statusLabel } from "@/lib/taxonomy";
import styles from "../../site.module.css";

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
  const entry = await getProject(slug);
  if (!entry) notFound();

  return (
    <article className={styles.page}>
      <JsonLd data={await articleLd({ type: "CreativeWork", ...entry, path: `/projects/${slug}` })} />
      <EntryHeader {...entry} meta={[disciplineLabel[entry.discipline], statusLabel[entry.status], entry.role, entry.client]} />
      <MarkdocContent tree={entry.body} />
    </article>
  );
}
