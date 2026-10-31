import Markdoc from "@markdoc/markdoc";
import Link from "next/link";
import React from "react";
import { CardGrid, PostList } from "@/components/cards";
import { getProjects, getExperiments, getPosts, type Section } from "@/lib/content";
import styles from "./sections.module.css";

/**
 * Renders page-builder sections from the CMS, in order.
 * Each `discriminant` matches a block key in keystatic.config.ts `sections`.
 */
export function Sections({ sections }: { sections: readonly Section[] }) {
  return (
    <>
      {sections.map((section, i) => {
        const Renderer = renderers[section.discriminant] as (props: { value: typeof section.value }) => React.ReactNode;
        return (
          <section key={i} className={styles.section} data-width={section.value.width} data-kind={section.discriminant}>
            <Renderer value={section.value} />
          </section>
        );
      })}
    </>
  );
}

type ValueOf<K extends Section["discriminant"]> = Extract<Section, { discriminant: K }>["value"];

function Markdown({ source }: { source: string }) {
  const tree = Markdoc.transform(Markdoc.parse(source));
  return <div className={styles.markdown}>{Markdoc.renderers.react(tree, React)}</div>;
}

function ButtonLink({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return (
    <Link href={href} className={primary ? styles.buttonPrimary : styles.button}>
      {label}
    </Link>
  );
}

const renderers: { [K in Section["discriminant"]]: (props: { value: ValueOf<K> }) => React.ReactNode } = {
  hero({ value }) {
    return (
      <div className={styles.hero}>
        {value.eyebrow && <p className={styles.eyebrow}>{value.eyebrow}</p>}
        <h1 className={styles.heroHeading}>{value.heading}</h1>
        {value.subheading && <p className={styles.lede}>{value.subheading}</p>}
        {value.links.length > 0 && (
          <div className={styles.actions}>
            {value.links.map((l, i) => (
              <ButtonLink key={l.href} href={l.href} label={l.label} primary={i === 0} />
            ))}
          </div>
        )}
      </div>
    );
  },

  text({ value }) {
    return (
      <>
        {value.heading && <h2 className={styles.heading}>{value.heading}</h2>}
        <Markdown source={value.body} />
      </>
    );
  },

  media({ value }) {
    if (!value.image) return null;
    return (
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element -- CMS images have unknown dimensions */}
        <img src={value.image} alt={value.alt} className={styles.media} loading="lazy" />
        {value.caption && <figcaption className={styles.caption}>{value.caption}</figcaption>}
      </figure>
    );
  },

  async featuredWork({ value }) {
    const all = await getProjects();
    const picked = value.items.filter(Boolean) as string[];
    const items = picked.length
      ? picked.map((slug) => all.find((c) => c.slug === slug)).filter((c) => c !== undefined)
      : all.filter((c) => c.featured);
    return (
      <>
        <div className={styles.headingRow}>
          <h2 className={styles.heading}>{value.heading}</h2>
          <Link href="/projects">All projects →</Link>
        </div>
        <CardGrid items={items.length ? items : all.slice(0, 4)} base="/projects" layout={value.layout} />
      </>
    );
  },

  async experiments({ value }) {
    const items = (await getExperiments()).slice(0, value.limit ?? 6);
    return (
      <>
        <div className={styles.headingRow}>
          <h2 className={styles.heading}>{value.heading}</h2>
          <Link href="/experiments">All experiments →</Link>
        </div>
        <CardGrid items={items} base="/experiments" />
      </>
    );
  },

  async latestPosts({ value }) {
    const posts = (await getPosts()).slice(0, value.limit ?? 3);
    return (
      <>
        <div className={styles.headingRow}>
          <h2 className={styles.heading}>{value.heading}</h2>
          <Link href="/writing">All writing →</Link>
        </div>
        <PostList posts={posts} />
      </>
    );
  },

  cta({ value }) {
    return (
      <div className={styles.cta}>
        {value.heading && <h2 className={styles.heading}>{value.heading}</h2>}
        {value.body && <p className={styles.lede}>{value.body}</p>}
        {value.link.href && <ButtonLink href={value.link.href} label={value.link.label} primary />}
      </div>
    );
  },
};
