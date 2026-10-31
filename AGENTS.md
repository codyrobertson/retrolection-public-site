<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project: portfolio + git-based CMS

- Content is files in `content/`, schema in `keystatic.config.ts`, read only through `src/lib/content.ts`. Read `CONTENT.md` before adding or changing content.
- Public pages live in `src/app/(site)/` and must stay fully static (`ensureStatic = "navigation"` in its layout). Don't read cookies/headers there.
- `/keystatic` is the editor UI; `/api/keystatic` is its backend. Neither is part of the public site.
- After changing content or schema, run `npm run build` — it validates every entry.
