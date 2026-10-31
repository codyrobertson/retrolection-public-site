import type { Metadata } from "next";
import { InkGL } from "@/components/ink-gl";
import { getSite } from "@/lib/content";
import { getSiteUrl } from "@/lib/seo";
import { inferi, messina, nichrome } from "./fonts";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const url = await getSiteUrl();
  return {
    metadataBase: new URL(url),
    title: { default: site.title || site.name, template: `%s — ${site.name}` },
    description: site.description || undefined,
    authors: [{ name: site.name, url }],
    creator: site.name,
    alternates: {
      canonical: "/",
      types: { "application/rss+xml": [{ url: "/feed.xml", title: `${site.name} — Writing` }] },
    },
    openGraph: { type: "website", siteName: site.name, locale: "en_US" },
    twitter: { card: "summary_large_image" },
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${messina.variable} ${inferi.variable} ${nichrome.variable}`}>
      <body>
        <InkGL />
        {children}
      </body>
    </html>
  );
}
