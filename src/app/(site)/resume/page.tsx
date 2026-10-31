import { notFound } from "next/navigation";
import { getResume, getSite } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";
import styles from "../site.module.css";
import resume from "./resume.module.css";

export async function generateMetadata() {
  const data = await getResume();
  return buildMetadata({ title: "Résumé", summary: data?.summary, seo: data?.seo, path: "/resume", type: "website" });
}

export default async function ResumePage() {
  const [data, site] = await Promise.all([getResume(), getSite()]);
  if (!data) notFound();

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{site.name}</h1>
        {data.headline && <p className={styles.lede}>{data.headline}</p>}
        <p className={styles.meta}>
          {data.location && <span>{data.location}</span>}
          {data.pdf && <a href={data.pdf}>Download PDF ↓</a>}
        </p>
      </header>

      {data.summary && <p className={resume.summary}>{data.summary}</p>}

      <section className={resume.section}>
        <h2 className={resume.heading}>Experience</h2>
        {data.experience.map((job) => (
          <div key={`${job.company}-${job.start}`} className={resume.item}>
            <p className={resume.when}>
              {job.start} – {job.end || "Present"}
            </p>
            <div>
              <h3 className={resume.role}>
                {job.role} · {job.url ? <a href={job.url}>{job.company}</a> : job.company}
              </h3>
              {job.location && <p className={resume.muted}>{job.location}</p>}
              {job.highlights.length > 0 && (
                <ul className={resume.highlights}>
                  {job.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </section>

      {data.skills.length > 0 && (
        <section className={resume.section}>
          <h2 className={resume.heading}>Skills</h2>
          {data.skills.map((group) => (
            <div key={group.group} className={resume.item}>
              <p className={resume.when}>{group.group}</p>
              <p>{group.items.join(", ")}</p>
            </div>
          ))}
        </section>
      )}

      {data.education.length > 0 && (
        <section className={resume.section}>
          <h2 className={resume.heading}>Education</h2>
          {data.education.map((ed) => (
            <div key={ed.school} className={resume.item}>
              <p className={resume.when}>{ed.year}</p>
              <p>
                {ed.school}
                {ed.detail && <span className={resume.muted}> — {ed.detail}</span>}
              </p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
