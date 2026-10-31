import { collection, config, fields, singleton } from "@keystatic/core";
import { block } from "@keystatic/core/content-components";
import { experimentComponentOptions } from "./src/experiments/manifest";

/**
 * Content schema for the whole site.
 *
 * Every entry is a plain file under `content/` (YAML for structured data,
 * `.mdoc` for rich text). Humans edit it through /keystatic; agents can edit
 * the files directly. See CONTENT.md for the file-level contract.
 */

const storage =
  process.env.NEXT_PUBLIC_KEYSTATIC_STORAGE === "github"
    ? ({
        kind: "github",
        repo: process.env.NEXT_PUBLIC_KEYSTATIC_GITHUB_REPO as `${string}/${string}`,
      } as const)
    : ({ kind: "local" } as const);

// ---------------------------------------------------------------------------
// Shared field groups
// ---------------------------------------------------------------------------

const seo = fields.object(
  {
    title: fields.text({
      label: "SEO title",
      description: "Overrides the page title in search results. Keep under ~60 characters.",
    }),
    description: fields.text({
      label: "SEO description",
      description: "Shown in search results and link previews. Aim for 120–160 characters.",
      multiline: true,
    }),
    noindex: fields.checkbox({
      label: "Hide from search engines",
      defaultValue: false,
    }),
  },
  { label: "SEO" },
);

const image = (label: string, dir: string) =>
  fields.image({
    label,
    directory: `public/images/${dir}`,
    publicPath: `/images/${dir}/`,
  });

const tags = fields.array(fields.text({ label: "Tag" }), {
  label: "Tags",
  itemLabel: (props) => props.value,
});

/** Rich-text components available inside every long-form body. */
export const richComponents = {
  Video: block({
    label: "Video",
    schema: {
      src: fields.text({
        label: "Video URL",
        description: "Path under /public (e.g. /videos/demo.mp4) or a full URL. YouTube/Vimeo links are embedded.",
      }),
      poster: fields.text({ label: "Poster image URL" }),
      caption: fields.text({ label: "Caption" }),
    },
  }),
  Callout: block({
    label: "Callout",
    schema: {
      tone: fields.select({
        label: "Tone",
        options: [
          { label: "Note", value: "note" },
          { label: "Insight", value: "insight" },
          { label: "Warning", value: "warning" },
        ],
        defaultValue: "note",
      }),
      text: fields.text({ label: "Text", multiline: true }),
    },
  }),
  Figure: block({
    label: "Figure (wide image)",
    schema: {
      src: fields.text({ label: "Image URL" }),
      alt: fields.text({ label: "Alt text" }),
      caption: fields.text({ label: "Caption" }),
      width: fields.select({
        label: "Width",
        options: [
          { label: "Text width", value: "narrow" },
          { label: "Wide", value: "wide" },
          { label: "Full bleed", value: "full" },
        ],
        defaultValue: "wide",
      }),
    },
  }),
  ExperimentEmbed: block({
    label: "Embed an experiment",
    schema: {
      experiment: fields.relationship({ label: "Experiment", collection: "experiments" }),
    },
  }),
};

const body = (dir: string) =>
  fields.markdoc({
    label: "Body",
    options: {
      image: { directory: `public/images/${dir}`, publicPath: `/images/${dir}/` },
    },
    components: richComponents,
  });

// ---------------------------------------------------------------------------
// Page-builder sections ("blocks"). Used by the home page and custom pages.
// Add a new section type here + a renderer in src/components/sections.
// ---------------------------------------------------------------------------

const sectionWidth = fields.select({
  label: "Width",
  options: [
    { label: "Text width", value: "narrow" },
    { label: "Standard", value: "standard" },
    { label: "Wide", value: "wide" },
    { label: "Full bleed", value: "full" },
  ],
  defaultValue: "standard",
});

const link = fields.object({
  label: fields.text({ label: "Label" }),
  href: fields.text({ label: "URL or path" }),
});

const sections = fields.blocks(
  {
    hero: {
      label: "Hero",
      schema: fields.object({
        eyebrow: fields.text({ label: "Eyebrow" }),
        heading: fields.text({ label: "Heading", validation: { isRequired: true } }),
        subheading: fields.text({ label: "Subheading", multiline: true }),
        links: fields.array(link, { label: "Buttons", itemLabel: (p) => p.fields.label.value }),
        width: sectionWidth,
      }),
      itemLabel: (p) => `Hero: ${p.fields.heading.value}`,
    },
    text: {
      label: "Text",
      schema: fields.object({
        heading: fields.text({ label: "Heading" }),
        body: fields.text({
          label: "Body",
          multiline: true,
          description: "Supports Markdown (links, bold, lists).",
        }),
        width: sectionWidth,
      }),
      itemLabel: (p) => `Text: ${p.fields.heading.value || "untitled"}`,
    },
    media: {
      label: "Image",
      schema: fields.object({
        image: image("Image", "sections"),
        alt: fields.text({ label: "Alt text" }),
        caption: fields.text({ label: "Caption" }),
        width: sectionWidth,
      }),
      itemLabel: (p) => `Image: ${p.fields.alt.value || "untitled"}`,
    },
    featuredWork: {
      label: "Featured case studies",
      schema: fields.object({
        heading: fields.text({ label: "Heading", defaultValue: "Selected work" }),
        items: fields.array(fields.relationship({ label: "Case study", collection: "caseStudies" }), {
          label: "Case studies",
          description: "Leave empty to show the featured case studies automatically.",
          itemLabel: (p) => p.value ?? "Select…",
        }),
        layout: fields.select({
          label: "Layout",
          options: [
            { label: "Grid", value: "grid" },
            { label: "List", value: "list" },
          ],
          defaultValue: "grid",
        }),
        width: sectionWidth,
      }),
      itemLabel: (p) => `Work: ${p.fields.heading.value}`,
    },
    experiments: {
      label: "Experiments grid",
      schema: fields.object({
        heading: fields.text({ label: "Heading", defaultValue: "Experiments" }),
        limit: fields.integer({ label: "How many", defaultValue: 6 }),
        width: sectionWidth,
      }),
      itemLabel: (p) => `Experiments: ${p.fields.heading.value}`,
    },
    latestPosts: {
      label: "Latest writing",
      schema: fields.object({
        heading: fields.text({ label: "Heading", defaultValue: "Writing" }),
        limit: fields.integer({ label: "How many", defaultValue: 3 }),
        width: sectionWidth,
      }),
      itemLabel: (p) => `Writing: ${p.fields.heading.value}`,
    },
    cta: {
      label: "Call to action",
      schema: fields.object({
        heading: fields.text({ label: "Heading" }),
        body: fields.text({ label: "Body", multiline: true }),
        link,
        width: sectionWidth,
      }),
      itemLabel: (p) => `CTA: ${p.fields.heading.value}`,
    },
  },
  { label: "Sections" },
);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export default config({
  storage,
  ui: {
    brand: { name: "Site CMS" },
    navigation: {
      Pages: ["home", "pages"],
      Work: ["caseStudies", "experiments", "posts"],
      About: ["resume"],
      Settings: ["site"],
    },
  },
  singletons: {
    site: singleton({
      label: "Site settings",
      path: "content/site",
      format: { data: "yaml" },
      schema: {
        name: fields.text({ label: "Your name", validation: { isRequired: true } }),
        title: fields.text({
          label: "Default page title",
          description: "Used on the home page and as the suffix for other pages.",
        }),
        description: fields.text({ label: "Default description", multiline: true }),
        url: fields.url({
          label: "Production URL",
          description: "e.g. https://example.com — used for canonical links, sitemap and social cards.",
        }),
        jobTitle: fields.text({ label: "Job title", defaultValue: "Design Engineer" }),
        nav: fields.array(link, { label: "Navigation", itemLabel: (p) => p.fields.label.value }),
        social: fields.array(
          fields.object({
            platform: fields.select({
              label: "Platform",
              options: [
                { label: "GitHub", value: "github" },
                { label: "LinkedIn", value: "linkedin" },
                { label: "X / Twitter", value: "x" },
                { label: "Bluesky", value: "bluesky" },
                { label: "Dribbble", value: "dribbble" },
                { label: "Email", value: "email" },
                { label: "Other", value: "other" },
              ],
              defaultValue: "github",
            }),
            url: fields.text({ label: "URL (or mailto:)" }),
          }),
          { label: "Social links", itemLabel: (p) => p.fields.platform.value },
        ),
      },
    }),

    home: singleton({
      label: "Home page",
      path: "content/home",
      format: { data: "yaml" },
      schema: { seo, sections },
    }),

    resume: singleton({
      label: "Résumé",
      path: "content/resume",
      format: { data: "yaml" },
      schema: {
        headline: fields.text({ label: "Headline" }),
        summary: fields.text({ label: "Summary", multiline: true }),
        location: fields.text({ label: "Location" }),
        pdf: fields.file({
          label: "PDF version",
          directory: "public/resume",
          publicPath: "/resume/",
        }),
        experience: fields.array(
          fields.object({
            company: fields.text({ label: "Company" }),
            role: fields.text({ label: "Role" }),
            url: fields.text({ label: "Company URL" }),
            location: fields.text({ label: "Location" }),
            start: fields.text({ label: "Start", description: "e.g. 2023 or Mar 2023" }),
            end: fields.text({ label: "End", description: "Leave empty for “Present”" }),
            highlights: fields.array(fields.text({ label: "Highlight", multiline: true }), {
              label: "Highlights",
              itemLabel: (p) => p.value,
            }),
          }),
          { label: "Experience", itemLabel: (p) => `${p.fields.role.value} — ${p.fields.company.value}` },
        ),
        skills: fields.array(
          fields.object({
            group: fields.text({ label: "Group" }),
            items: fields.array(fields.text({ label: "Skill" }), {
              label: "Skills",
              itemLabel: (p) => p.value,
            }),
          }),
          { label: "Skills", itemLabel: (p) => p.fields.group.value },
        ),
        education: fields.array(
          fields.object({
            school: fields.text({ label: "School" }),
            detail: fields.text({ label: "Degree / detail" }),
            year: fields.text({ label: "Year" }),
          }),
          { label: "Education", itemLabel: (p) => p.fields.school.value },
        ),
        seo,
      },
    }),
  },

  collections: {
    caseStudies: collection({
      label: "Case studies",
      slugField: "title",
      path: "content/case-studies/*",
      format: { contentField: "body" },
      entryLayout: "content",
      columns: ["title", "date"],
      schema: {
        title: fields.slug({ name: { label: "Title" } }),
        summary: fields.text({ label: "Summary", multiline: true, validation: { length: { min: 1 } } }),
        date: fields.date({ label: "Date", validation: { isRequired: true } }),
        role: fields.text({ label: "Your role" }),
        client: fields.text({ label: "Client / company" }),
        cover: image("Cover image", "case-studies"),
        coverAlt: fields.text({ label: "Cover alt text" }),
        tags,
        featured: fields.checkbox({ label: "Featured", defaultValue: false }),
        draft: fields.checkbox({ label: "Draft (hidden from the site)", defaultValue: false }),
        seo,
        body: body("case-studies"),
      },
    }),

    experiments: collection({
      label: "Experiments",
      slugField: "title",
      path: "content/experiments/*",
      format: { contentField: "body" },
      entryLayout: "content",
      columns: ["title", "date"],
      schema: {
        title: fields.slug({ name: { label: "Title" } }),
        summary: fields.text({ label: "Summary", multiline: true }),
        date: fields.date({ label: "Date", validation: { isRequired: true } }),
        cover: image("Thumbnail", "experiments"),
        coverAlt: fields.text({ label: "Thumbnail alt text" }),
        tags,
        source: fields.conditional(
          fields.select({
            label: "Format",
            description: "How the experiment is hosted.",
            options: [
              { label: "React component in this repo", value: "component" },
              { label: "Static bundle (HTML/JS in /public/lab)", value: "static" },
              { label: "External embed (URL)", value: "embed" },
              { label: "Write-up only", value: "none" },
            ],
            defaultValue: "none",
          }),
          {
            component: fields.select({
              label: "Component",
              description: "Registered in src/experiments/manifest.ts",
              options: experimentComponentOptions,
              defaultValue: experimentComponentOptions[0].value,
            }),
            static: fields.text({
              label: "Folder name",
              description: "Folder under public/lab/ containing an index.html, e.g. “particle-field”.",
            }),
            embed: fields.url({ label: "Embed URL" }),
            none: fields.empty(),
          },
        ),
        aspect: fields.select({
          label: "Frame shape",
          options: [
            { label: "16:9", value: "16/9" },
            { label: "4:3", value: "4/3" },
            { label: "1:1", value: "1/1" },
            { label: "Tall (3:4)", value: "3/4" },
          ],
          defaultValue: "16/9",
        }),
        repo: fields.url({ label: "Source code URL" }),
        draft: fields.checkbox({ label: "Draft (hidden from the site)", defaultValue: false }),
        seo,
        body: body("experiments"),
      },
    }),

    posts: collection({
      label: "Writing",
      slugField: "title",
      path: "content/posts/*",
      format: { contentField: "body" },
      entryLayout: "content",
      columns: ["title", "date"],
      schema: {
        title: fields.slug({ name: { label: "Title" } }),
        summary: fields.text({ label: "Summary", multiline: true }),
        date: fields.date({ label: "Published", validation: { isRequired: true } }),
        updated: fields.date({ label: "Last updated" }),
        cover: image("Cover image", "posts"),
        coverAlt: fields.text({ label: "Cover alt text" }),
        tags,
        draft: fields.checkbox({ label: "Draft (hidden from the site)", defaultValue: false }),
        seo,
        body: body("posts"),
      },
    }),

    pages: collection({
      label: "Custom pages",
      slugField: "title",
      path: "content/pages/*",
      format: { data: "yaml" },
      schema: {
        title: fields.slug({
          name: { label: "Title" },
          slug: { label: "URL", description: "The page lives at /<url>." },
        }),
        seo,
        sections,
      },
    }),
  },
});
