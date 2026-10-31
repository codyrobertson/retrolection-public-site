import { Suspense } from "react";
import { notFound } from "next/navigation";
import { EntryHeader } from "@/components/entry-header";
import { ExperimentFrame } from "@/components/experiment-frame";
import { JsonLd } from "@/components/json-ld";
import { MarkdocContent } from "@/components/markdoc";
import { articleLd } from "@/lib/article-ld";
import { getExperiment, getExperiments } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";
import styles from "../../site.module.css";

export async function generateStaticParams() {
  return (await getExperiments()).map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: PageProps<"/experiments/[slug]">) {
  const { slug } = await params;
  const entry = await getExperiment(slug);
  if (!entry) return {};
  return buildMetadata({
    title: entry.title,
    summary: entry.summary,
    seo: entry.seo,
    path: `/experiments/${slug}`,
    image: entry.cover,
    type: "article",
    publishedTime: entry.date,
  });
}

// Every slug is prerendered; the boundary only covers the shell for unknown slugs.
export default function Page({ params }: PageProps<"/experiments/[slug]">) {
  return (
    <Suspense>
      <ExperimentPage params={params} />
    </Suspense>
  );
}

async function ExperimentPage({ params }: Pick<PageProps<"/experiments/[slug]">, "params">) {
  const { slug } = await params;
  const entry = await getExperiment(slug);
  if (!entry) notFound();

  return (
    <article className={styles.page}>
      <JsonLd data={await articleLd({ type: "CreativeWork", ...entry, cover: entry.cover, path: `/experiments/${slug}` })} />
      <EntryHeader title={entry.title} summary={entry.summary} date={entry.date} meta={entry.tags} />
      <ExperimentFrame experiment={entry} />
      {entry.repo && (
        <p className={styles.meta}>
          <a href={entry.repo} target="_blank" rel="noopener">
            View source ↗
          </a>
        </p>
      )}
      <MarkdocContent tree={entry.body} />
    </article>
  );
}
