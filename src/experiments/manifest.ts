/**
 * Experiments implemented as React components in this repo.
 *
 * To add one:
 *   1. Create `src/experiments/<id>.tsx` with a default-exported client component.
 *   2. Add `{ label, value: "<id>" }` below.
 *   3. Map the id to a dynamic import in `src/experiments/registry.tsx`.
 * The option then shows up in the CMS "Component" dropdown.
 */
export const experimentComponentOptions = [
  { label: "Cursor trail (demo)", value: "cursor-trail" },
] as const;

export type ExperimentComponentId = (typeof experimentComponentOptions)[number]["value"];
