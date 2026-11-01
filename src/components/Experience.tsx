import { getResume } from "@/lib/content";
import ExperienceList, { type Job } from "./ExperienceList";
import BlackInk from "./BlackInk";
import LiveInk from "./LiveInk";
import styles from "./experience.module.css";

const NN = (n: number) => String(n).padStart(2, "0");

/**
 * Plate 03, after the board is taken away and the lights go down: the work history as a
 * ledger, each line opening to what was done there, and the practice under it. In the page's
 * ink, on a layer of its own, so a line prints as it opens (LiveInk).
 */
export default async function Experience() {
  const data = await getResume();
  if (!data?.experience.length) return null;
  const jobs: Job[] = data.experience.map((j) => ({
    company: j.company, role: j.role, url: j.url || "", location: j.location || "",
    when: j.start ? `${j.start}–${j.end || "Now"}` : "", highlights: [...j.highlights],
  }));
  return (
    <section id="experience" className={styles.section} aria-labelledby="experience-title">
      <BlackInk kind="experience" />
      <LiveInk id="ink-experience-gl" className={styles.inner}>
        <p className={styles.label}>
          <span>03 / Experience</span>
          <span>{NN(jobs.length)} roles</span>
        </p>
        <h2 id="experience-title" className={styles.title}>{data.headline}</h2>
        {data.summary && <p className={styles.summary}>{data.summary}</p>}
        <ExperienceList jobs={jobs} dated={jobs.some((j) => j.when)} />
        {(data.skills.length > 0 || data.education.length > 0) && (
          <div className={styles.practice}>
            {data.skills.map((g) => (
              <div key={g.group} className={styles.group}>
                <h3 className={styles.groupTitle}>{g.group}</h3>
                <ul>{g.items.map((it) => <li key={it}>{it}</li>)}</ul>
              </div>
            ))}
            {data.education.length > 0 && (
              <div className={styles.group}>
                <h3 className={styles.groupTitle}>Education</h3>
                <ul>{data.education.map((e) => <li key={e.school}>{e.school}<span className={styles.detail}>{e.detail}</span></li>)}</ul>
              </div>
            )}
          </div>
        )}
      </LiveInk>
    </section>
  );
}
