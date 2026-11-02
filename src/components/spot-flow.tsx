"use client";

import { useEffect, useRef } from "react";

/** Flows the story's text round its spot illustrations (spot-flow.ts). Renders a hidden marker; works on its parent. */
export function SpotFlow() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = ref.current?.parentElement;
    if (!root || !root.querySelector("figure[data-spot]")) return;
    let stop = () => {};
    let cancelled = false;
    import("@/lib/spot-flow").then(({ startSpotFlow }) => {
      if (!cancelled) stop = startSpotFlow(root);
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return <span ref={ref} hidden />;
}
