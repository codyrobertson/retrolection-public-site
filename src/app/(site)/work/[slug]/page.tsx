import { Suspense } from "react";
import { notFound } from "next/navigation";
import { EntryHeader } from "@/components/entry-header";
import { JsonLd } from "@/components/json-ld";
import { MarkdocContent } from "@/components/markdoc";
import { articleLd } from "@/lib/article-ld";
import { getCaseStudies, getCaseStudy } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";
import styles from "../../site.module.css";

export async function generateStaticParams() {
  return (await getCaseStudies()).map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps<"/work/[slug]">) {
  const { slug } = await params;
  const entry = await getCaseStudy(slug);
  if (!entry) return {};
  return buildMetadata({
    title: entry.title,
    summary: entry.summary,
    seo: entry.seo,
    path: `/work/${slug}`,
    image: entry.cover,
    type: "article",
    publishedTime: entry.date,
  });
}

// Every slug is prerendered; the boundary only covers the shell for unknown slugs.
export default function Page({ params }: PageProps<"/work/[slug]">) {
  return (
    <Suspense>
      <CaseStudyPage params={params} />
    </Suspense>
  );
}

async function CaseStudyPage({ params }: Pick<PageProps<"/work/[slug]">, "params">) {
  const { slug } = await params;
  const entry = await getCaseStudy(slug);
  if (!entry) notFound();

  return (
    <article className={styles.page}>
      <JsonLd data={await articleLd({ type: "CreativeWork", ...entry, path: `/work/${slug}` })} />
      <EntryHeader {...entry} meta={[entry.role, entry.client]} />
      <MarkdocContent tree={entry.body} />
    </article>
  );
}
