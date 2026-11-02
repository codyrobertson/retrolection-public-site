import { cacheLife } from "next/cache";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Markdoc, { type RenderableTreeNode } from "@markdoc/markdoc";
import React from "react";
import { getExperiment } from "@/lib/content";
import { ExperimentFrame } from "./experiment-frame";
import styles from "./prose.module.css";

/**
 * Renderers for the custom blocks defined in keystatic.config.ts (`richComponents`).
 * The key must match the component name in the config.
 */
const components = {
  Video({ src, poster, caption }: { src: string; poster?: string; caption?: string }) {
    const embed = toVideoEmbed(src);
    return (
      <figure className={styles.wide}>
        {embed ? (
          <iframe
            src={embed}
            title={caption || "Video"}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
            className={styles.video}
          />
        ) : (
          <video src={src} poster={poster || undefined} controls playsInline preload="metadata" className={styles.video} />
        )}
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    );
  },
  Callout({ tone, text }: { tone: string; text: string }) {
    return (
      <aside className={styles.callout} data-tone={tone}>
        {text}
      </aside>
    );
  },
  async Figure({ src, alt, caption, width, frame }: { src: string; alt: string; caption?: string; width: string; frame?: Frame }) {
    const chart = src.endsWith(".svg") && src.startsWith("/") ? await inlineIllo(src, alt) : null;
    return (
      <figure className={styles[width] ?? styles.wide}>
        {chart ? <div className={styles.chart} dangerouslySetInnerHTML={{ __html: chart }} /> : <Framed src={src} alt={alt} frame={frame} />}
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    );
  },
  Spot({ src, alt, side = "right" }: { src: string; alt: string; side?: string }) {
    // floats beside the section's text; the text wraps the cut-out's silhouette (its alpha), not its box
    return (
      <figure className={styles.spot} data-spot data-side={side === "left" ? "left" : "right"} style={{ shapeOutside: `url(${src})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- CMS images have unknown dimensions */}
        <img src={src} alt={alt} />
      </figure>
    );
  },
  Gallery({
    images = [],
    columns = "2",
    frame,
    caption,
  }: {
    images?: { src: string; alt: string }[];
    columns?: string;
    frame?: Frame;
    caption?: string;
  }) {
    return (
      <figure className={styles.wide}>
        <div className={styles.gallery} data-columns={columns}>
          {images.map((img) => (
            <Framed key={img.src} {...img} frame={frame} />
          ))}
        </div>
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    );
  },
  async ExperimentEmbed({ experiment }: { experiment: string | null }) {
    const entry = experiment ? await getExperiment(experiment) : null;
    if (!entry) return null;
    return (
      <figure className={styles.wide}>
        <ExperimentFrame experiment={entry} />
        <figcaption>
          <a href={`/experiments/${entry.slug}`}>{entry.title}</a>
        </figcaption>
      </figure>
    );
  },
};

/** Local SVG charts go inline as `data-illo` so the pencil and marker shaders draw them (see illo-gl.js).
    Cached: the file read is I/O, and the page must prerender. */
async function inlineIllo(src: string, alt: string) {
  "use cache";
  cacheLife("max");
  try {
    const svg = await readFile(path.join(process.cwd(), "public", src), "utf8");
    const label = alt.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    return svg
      .replace(/<\?xml[^>]*>\s*/, "")
      .replace(/<svg\b([^>]*)>/, (_, a: string) => `<svg${a.replace(/\s(width|height)="[^"]*"/g, "")} data-illo role="img" aria-label="${label}">`);
  } catch {
    return null;
  }
}

type Frame = "none" | "browser" | "phone";

function Framed({ src, alt, frame = "none" }: { src: string; alt: string; frame?: Frame }) {
  // eslint-disable-next-line @next/next/no-img-element -- CMS images have unknown dimensions
  const img = <img src={src} alt={alt} loading="lazy" />;
  if (frame === "none") return img;
  return (
    <div className={styles.frame} data-frame={frame}>
      {frame === "browser" && <span className={styles.chrome} aria-hidden="true" />}
      {img}
    </div>
  );
}

function toVideoEmbed(src: string) {
  const yt = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = src.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

/** `story` sets the body as a feature: a narrower serif column, a drop cap, ruled charts and captions. */
export function MarkdocContent({ tree, variant }: { tree: RenderableTreeNode; variant?: "story" }) {
  const cls = variant === "story" ? `${styles.prose} ${styles.story}` : styles.prose;
  return <div className={cls}>{Markdoc.renderers.react(tree, React, { components })}</div>;
}
