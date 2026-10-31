import { CardGrid } from "@/components/cards";
import { DisciplineFilter } from "@/components/discipline-filter";
import { getProjects } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";
import styles from "../site.module.css";

export const generateMetadata = () =>
  buildMetadata({ title: "Projects", summary: "Selected projects across design and code.", path: "/projects" });

export default async function ProjectsIndex() {
  const items = await getProjects();
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Projects</h1>
      </header>
      <DisciplineFilter name="projects-discipline">
        <CardGrid items={items} base="/projects" />
      </DisciplineFilter>
    </div>
  );
}
