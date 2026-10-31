import "server-only";

import Markdoc, { type Node, type RenderableTreeNode } from "@markdoc/markdoc";
import { fields } from "@keystatic/core";
import { createReader } from "@keystatic/core/reader";
import { cacheLife } from "next/cache";
import keystaticConfig, { richComponents } from "../../keystatic.config";

/**
 * The only module that reads `content/`. Pages import typed getters from here.
 * Content only changes on deploy, so every getter is cached for the lifetime of a build.
 */

const reader = createReader(process.cwd(), keystaticConfig);

const showDrafts = process.env.NODE_ENV === "development";

type Collection = "caseStudies" | "experiments" | "posts";

const markdocConfig = fields.markdoc.createMarkdocConfig({
  components: richComponents,
  // Render each custom tag with the React component of the same name (src/components/markdoc.tsx).
  render: { tags: Object.fromEntries(Object.keys(richComponents).map((name) => [name, name])) },
});

/** Markdoc AST -> plain renderable tree (serialisable so it can be cached). */
function toTree(node: Node): RenderableTreeNode {
  const errors = Markdoc.validate(node, markdocConfig);
  if (errors.length) {
    console.warn("Markdoc validation:", errors.map((e) => e.error.message).join("; "));
  }
  return JSON.parse(JSON.stringify(Markdoc.transform(node, markdocConfig)));
}

const byDateDesc = <T extends { date: string | null }>(a: T, b: T) =>
  (b.date ?? "").localeCompare(a.date ?? "");

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

export async function getSite() {
  "use cache";
  cacheLife("max");
  const site = await reader.singletons.site.read();
  if (!site) throw new Error("content/site.yaml is missing");
  return site;
}

export async function getHome() {
  "use cache";
  cacheLife("max");
  return (await reader.singletons.home.read()) ?? { seo: emptySeo, sections: [] };
}

export async function getResume() {
  "use cache";
  cacheLife("max");
  return reader.singletons.resume.read();
}

const emptySeo = { title: "", description: "", noindex: false };

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

async function list<C extends Collection>(collection: C) {
  const entries = await reader.collections[collection].all();
  return entries
    .filter((e) => showDrafts || !e.entry.draft)
    .map(({ slug, entry }) => {
      // `body` is a lazy loader; strip it from listings.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { body: _body, ...meta } = entry;
      return { slug, ...meta };
    })
    .sort(byDateDesc);
}

async function one<C extends Collection>(collection: C, slug: string) {
  const entry = await reader.collections[collection].read(slug, { resolveLinkedFiles: true });
  if (!entry || (entry.draft && !showDrafts)) return null;
  const { body, ...meta } = entry;
  return { slug, ...meta, body: toTree(body.node) };
}

export async function getCaseStudies() {
  "use cache";
  cacheLife("max");
  return list("caseStudies");
}

export async function getCaseStudy(slug: string) {
  "use cache";
  cacheLife("max");
  return one("caseStudies", slug);
}

export async function getExperiments() {
  "use cache";
  cacheLife("max");
  return list("experiments");
}

export async function getExperiment(slug: string) {
  "use cache";
  cacheLife("max");
  return one("experiments", slug);
}

export async function getPosts() {
  "use cache";
  cacheLife("max");
  return list("posts");
}

export async function getPost(slug: string) {
  "use cache";
  cacheLife("max");
  return one("posts", slug);
}

export async function getPages() {
  "use cache";
  cacheLife("max");
  const pages = await reader.collections.pages.all();
  return pages.map(({ slug, entry }) => ({ slug, ...entry }));
}

export async function getPage(slug: string) {
  "use cache";
  cacheLife("max");
  const page = await reader.collections.pages.read(slug);
  return page ? { slug, ...page } : null;
}

export type CaseStudySummary = Awaited<ReturnType<typeof getCaseStudies>>[number];
export type ExperimentSummary = Awaited<ReturnType<typeof getExperiments>>[number];
export type PostSummary = Awaited<ReturnType<typeof getPosts>>[number];
export type Experiment = NonNullable<Awaited<ReturnType<typeof getExperiment>>>;
export type Section = Awaited<ReturnType<typeof getHome>>["sections"][number];
