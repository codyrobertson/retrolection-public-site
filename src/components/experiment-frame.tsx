import type { Experiment } from "@/lib/content";
import { ExperimentComponent } from "@/experiments/registry";
import styles from "./experiment-frame.module.css";

type Props = { experiment: Pick<Experiment, "title" | "source" | "aspect"> };

/** Renders an experiment in whichever hosting format it was configured with. */
export function ExperimentFrame({ experiment }: Props) {
  const { source, aspect, title } = experiment;
  if (source.discriminant === "none") return null;

  return (
    <div className={styles.frame} style={{ aspectRatio: aspect }}>
      {source.discriminant === "component" && <ExperimentComponent id={source.value} />}
      {source.discriminant === "static" && (
        <iframe src={`/lab/${source.value}/index.html`} title={title} loading="lazy" className={styles.iframe} />
      )}
      {source.discriminant === "embed" && source.value && (
        <iframe
          src={source.value}
          title={title}
          loading="lazy"
          allow="fullscreen; clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          className={styles.iframe}
        />
      )}
    </div>
  );
}
