import { CardGrid } from "@/components/cards";
import { DisciplineFilter } from "@/components/discipline-filter";
import { getExperiments } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";
import styles from "../site.module.css";

export const generateMetadata = () =>
  buildMetadata({ title: "Experiments", summary: "Interactive prototypes and explorations.", path: "/experiments" });

export default async function ExperimentsIndex() {
  const items = await getExperiments();
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Experiments</h1>
      </header>
      <DisciplineFilter name="experiments-discipline">
        <CardGrid items={items} base="/experiments" />
      </DisciplineFilter>
    </div>
  );
}
