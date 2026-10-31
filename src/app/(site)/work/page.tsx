import { CardGrid } from "@/components/cards";
import { getCaseStudies } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";
import styles from "../site.module.css";

export const generateMetadata = () =>
  buildMetadata({ title: "Work", summary: "Selected case studies.", path: "/work" });

export default async function WorkIndex() {
  const items = await getCaseStudies();
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Work</h1>
      </header>
      <CardGrid items={items} base="/work" />
    </div>
  );
}
