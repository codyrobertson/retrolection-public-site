import type { Discipline, ProjectStatus } from "./content";

export const disciplineLabel: Record<Discipline, string> = {
  design: "Design",
  code: "Code",
  "design-code": "Design + Code",
};

export const statusLabel: Record<ProjectStatus, string> = {
  active: "Active",
  hobby: "Hobby",
  retired: "Retired",
};
