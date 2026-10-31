import { CardGrid } from "@/components/cards";
import { DisciplineFilter } from "@/components/discipline-filter";
import { getArtifacts } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";
import styles from "../site.module.css";

export const generateMetadata = () =>
  buildMetadata({ title: "Artifacts", summary: "Scratch pad: sketches, snippets, and loose ends.", path: "/artifacts" });

export default async function ArtifactsIndex() {
  const items = await getArtifacts();
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Artifacts</h1>
      </header>
      <DisciplineFilter name="artifacts-discipline">
        <CardGrid items={items} base="/artifacts" />
      </DisciplineFilter>
    </div>
  );
}
