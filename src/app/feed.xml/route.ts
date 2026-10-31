import { getPosts, getSite } from "@/lib/content";
import { getSiteUrl } from "@/lib/seo";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET() {
  const [site, url, posts] = await Promise.all([getSite(), getSiteUrl(), getPosts()]);

  const items = posts
    .map(
      (p) => `    <item>
      <title>${escape(p.title)}</title>
      <link>${url}/writing/${p.slug}</link>
      <guid>${url}/writing/${p.slug}</guid>
      ${p.date ? `<pubDate>${new Date(p.date).toUTCString()}</pubDate>` : ""}
      ${p.summary ? `<description>${escape(p.summary)}</description>` : ""}
    </item>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escape(site.name)} — Writing</title>
    <link>${url}/writing</link>
    <description>${escape(site.description || "")}</description>
    <atom:link href="${url}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
