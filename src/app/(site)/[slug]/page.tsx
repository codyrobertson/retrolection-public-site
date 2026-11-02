import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Sections } from "@/components/sections";
import { getPage, getPages } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";

export async function generateStaticParams() {
  return (await getPages()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[slug]">) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) return { title: "Not found" };   // the slug catches every unknown path: name the 404 it renders
  return buildMetadata({ title: page.title, seo: page.seo, path: `/${slug}` });
}

// Every slug is prerendered; the boundary only covers the shell for unknown slugs.
export default function Page({ params }: PageProps<"/[slug]">) {
  return (
    <Suspense>
      <CustomPage params={params} />
    </Suspense>
  );
}

async function CustomPage({ params }: Pick<PageProps<"/[slug]">, "params">) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) notFound();
  return <Sections sections={page.sections} />;
}
