# Content guide

All site content is plain files in `content/`, edited by people through the CMS at
`/keystatic` and by agents directly. The schema lives in `keystatic.config.ts`; the build
fails if a file doesn't match it.

## Where things live

| What | File(s) | URL |
| --- | --- | --- |
| Site settings (name, nav, socials, production URL) | `content/site.yaml` | — |
| Home page sections | `content/home.yaml` | `/` |
| Résumé | `content/resume.yaml` | `/resume` |
| Projects | `content/projects/<slug>.mdoc` | `/projects/<slug>` |
| Experiments | `content/experiments/<slug>.mdoc` | `/experiments/<slug>` |
| Writing | `content/posts/<slug>.mdoc` | `/writing/<slug>` |
| Artifacts (scratch pad) | `content/artifacts/<slug>.mdoc` | `/artifacts/<slug>` |
| Custom pages (About, etc.) | `content/pages/<slug>.yaml` | `/<slug>` |
| Uploaded images | `public/images/<collection>/` | `/images/...` |
| Static experiment bundles | `public/lab/<folder>/index.html` | `/lab/<folder>/` |

The filename is the slug. `.mdoc` files are YAML frontmatter + a [Markdoc](https://markdoc.dev) body.

## Taxonomy

- `discipline` (projects, experiments, artifacts): `design` | `code` | `design-code`.
  `design-code` counts as both: the index filter shows it under Design and under Code,
  and the "Design + Code" option narrows to only those.
- `status` (projects only): `active` | `hobby` | `retired`. Project lists sort
  active → hobby → retired, newest first within each.
- Artifacts are freeform: title, date and body are all that's needed.

Labels: `src/lib/taxonomy.ts`. Filter: `src/components/discipline-filter.tsx` (CSS only).

## Rich-text components (`.mdoc` bodies)

```markdoc
{% Callout tone="note|insight|warning" text="…" /%}
{% Video src="/videos/x.mp4 or YouTube/Vimeo URL" poster="" caption="" /%}
{% Figure src="/images/posts/x.png" alt="…" caption="" width="narrow|wide|full" frame="none|browser|phone" /%}
{% Gallery images=[{src: "/images/a.webp", alt: "…"}, {src: "/images/b.webp", alt: "…"}] columns="2|3|4" frame="none|browser|phone" caption="" /%}
{% ExperimentEmbed experiment="<experiment-slug>" /%}
```

Renderers: `src/components/markdoc.tsx`.

## Page-builder sections (`home.yaml`, `pages/*.yaml`)

`sections` is an ordered list of `{ discriminant, value }`. Types: `hero`, `text`, `media`,
`featuredWork`, `experiments`, `latestPosts`, `cta`. Every section has
`width: narrow|standard|wide|full`. Renderers: `src/components/sections/index.tsx`.

## Experiments

`source.discriminant` picks the hosting format:

- `component` — `value` is an id from `src/experiments/manifest.ts` (React component in the repo)
- `static` — `value` is a folder name under `public/lab/` containing `index.html`
- `embed` — `value` is an external URL loaded in a sandboxed iframe
- `none` — write-up only

## Extending the shape

| Change | Where |
| --- | --- |
| New field on an existing type | add it to the schema in `keystatic.config.ts`, render it in the page |
| New section type | `sections` in `keystatic.config.ts` + a renderer in `src/components/sections/index.tsx` |
| New rich-text component | `richComponents` in `keystatic.config.ts` + `components` in `src/components/markdoc.tsx` |
| New React experiment | `src/experiments/<id>.tsx` + `manifest.ts` + `registry.tsx` |
| New content type | collection in `keystatic.config.ts`, getters in `src/lib/content.ts`, routes in `src/app/(site)/`, add to `sitemap.ts` |

## Drafts and SEO

- `draft: true` hides an entry in production (it still shows in `npm run dev`).
- Every entry has `seo.title`, `seo.description`, `seo.noindex`. Empty values fall back to title / summary.
- Sitemap, robots, RSS (`/feed.xml`), canonical URLs, Open Graph, and JSON-LD are generated automatically.
