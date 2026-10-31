"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { ExperimentComponentId } from "./manifest";

const registry: Record<ExperimentComponentId, ComponentType> = {
  "cursor-trail": dynamic(() => import("./cursor-trail"), { ssr: false }),
};

export function ExperimentComponent({ id }: { id: string }) {
  const Component = registry[id as ExperimentComponentId];
  if (!Component) return <p>Unknown experiment component “{id}”.</p>;
  return <Component />;
}
