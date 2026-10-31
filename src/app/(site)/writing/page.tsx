import { PostList } from "@/components/cards";
import { getPosts } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";
import styles from "../site.module.css";

export const generateMetadata = () => buildMetadata({ title: "Writing", summary: "Notes and essays.", path: "/writing" });

export default async function WritingIndex() {
  const posts = await getPosts();
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Writing</h1>
      </header>
      <PostList posts={posts} />
    </div>
  );
}
