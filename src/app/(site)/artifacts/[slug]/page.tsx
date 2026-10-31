import { Suspense } from "react";
import { notFound } from "next/navigation";
import { EntryHeader } from "@/components/entry-header";
import { JsonLd } from "@/components/json-ld";
import { MarkdocContent } from "@/components/markdoc";
import { articleLd } from "@/lib/article-ld";
import { getArtifacts, getArtifact } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";
import { disciplineLabel } from "@/lib/taxonomy";
import styles from "../../site.module.css";

export async function generateStaticParams() {
  return (await getArtifacts()).map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps<"/artifacts/[slug]">) {
  const { slug } = await params;
  const entry = await getArtifact(slug);
  if (!entry) return {};
  return buildMetadata({
    title: entry.title,
    summary: entry.summary,
    seo: entry.seo,
    path: `/artifacts/${slug}`,
    image: entry.cover,
    type: "article",
    publishedTime: entry.date,
  });
}

// Every slug is prerendered; the boundary only covers the shell for unknown slugs.
export default function Page({ params }: PageProps<"/artifacts/[slug]">) {
  return (
    <Suspense>
      <ArtifactPage params={params} />
    </Suspense>
  );
}

async function ArtifactPage({ params }: Pick<PageProps<"/artifacts/[slug]">, "params">) {
  const { slug } = await params;
  const entry = await getArtifact(slug);
  if (!entry) notFound();

  return (
    <article className={styles.page}>
      <JsonLd data={await articleLd({ type: "CreativeWork", ...entry, path: `/artifacts/${slug}` })} />
      <EntryHeader {...entry} meta={[disciplineLabel[entry.discipline], entry.link]} />
      <MarkdocContent tree={entry.body} />
    </article>
  );
}
