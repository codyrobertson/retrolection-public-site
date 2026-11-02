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
  Figure({ src, alt, caption, width, frame }: { src: string; alt: string; caption?: string; width: string; frame?: Frame }) {
    return (
      <figure className={styles[width] ?? styles.wide}>
        <Framed src={src} alt={alt} frame={frame} />
        {caption && <figcaption>{caption}</figcaption>}
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

export function MarkdocContent({ tree }: { tree: RenderableTreeNode }) {
  return <div className={styles.prose}>{Markdoc.renderers.react(tree, React, { components })}</div>;
}
