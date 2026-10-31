import { getPost, getPosts, getSite } from "@/lib/content";
import { ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "Article social card";

export async function generateStaticParams() {
  return (await getPosts()).map((p) => ({ slug: p.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [post, site] = await Promise.all([getPost(slug), getSite()]);
  return ogImage({ title: post?.title ?? site.name, kicker: "Writing", name: site.name });
}
