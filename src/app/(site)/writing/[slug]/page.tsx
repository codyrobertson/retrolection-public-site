import { Suspense } from "react";
import { notFound } from "next/navigation";
import { EntryHeader } from "@/components/entry-header";
import { JsonLd } from "@/components/json-ld";
import { MarkdocContent } from "@/components/markdoc";
import { articleLd } from "@/lib/article-ld";
import { getPost, getPosts } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";
import styles from "../../site.module.css";

export async function generateStaticParams() {
  return (await getPosts()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/writing/[slug]">) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};
  return buildMetadata({
    title: post.title,
    summary: post.summary,
    seo: post.seo,
    path: `/writing/${slug}`,
    image: post.cover,
    type: "article",
    publishedTime: post.date,
    modifiedTime: post.updated,
  });
}

// Every slug is prerendered; the boundary only covers the shell for unknown slugs.
export default function Page({ params }: PageProps<"/writing/[slug]">) {
  return (
    <Suspense>
      <PostPage params={params} />
    </Suspense>
  );
}

async function PostPage({ params }: Pick<PageProps<"/writing/[slug]">, "params">) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return (
    <article className={styles.page}>
      <JsonLd data={await articleLd({ type: "BlogPosting", ...post, path: `/writing/${slug}` })} />
      <EntryHeader {...post} meta={post.tags} />
      <MarkdocContent tree={post.body} />
    </article>
  );
}
