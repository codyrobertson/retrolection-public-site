import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { getSite } from "@/lib/content";
import { getSiteUrl } from "@/lib/seo";
import styles from "./site.module.css";

/** Public site pages must prerender fully; the build fails if one reads request data. */
export const ensureStatic = "navigation";

/** Evaluated once per build, so the page stays static. */
async function BuildYear() {
  "use cache";
  return new Date().getFullYear();
}

export default async function SiteLayout({ children }: LayoutProps<"/">) {
  const site = await getSite();
  const url = await getSiteUrl();

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "WebSite", "@id": `${url}/#website`, url, name: site.name, publisher: { "@id": `${url}/#person` } },
            {
              "@type": "Person",
              "@id": `${url}/#person`,
              name: site.name,
              jobTitle: site.jobTitle || undefined,
              url,
              sameAs: site.social.map((s) => s.url).filter((u) => u.startsWith("http")),
            },
          ],
        }}
      />
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          {site.name}
        </Link>
        <nav aria-label="Primary">
          <ul className={styles.nav}>
            {site.nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        <p>
          © <BuildYear /> {site.name}
        </p>
        <ul className={styles.nav}>
          {site.social.map((s) => (
            <li key={s.url}>
              <a href={s.url} rel="me noopener" target={s.url.startsWith("http") ? "_blank" : undefined}>
                {s.platform}
              </a>
            </li>
          ))}
          <li>
            <a href="/feed.xml">RSS</a>
          </li>
        </ul>
      </footer>
    </>
  );
}
