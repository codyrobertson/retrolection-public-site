import Contact from "@/components/Contact";
import Experience from "@/components/Experience";
import TypingPlate from "@/components/TypingPlate";
import { workItems } from "@/components/WorkPlate";
import { getHome, getProjects, getSite } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";

/** lines on the home sheet: the featured work first, then the rest as the projects list has it */
const ON_SHEET = 9;

export async function generateMetadata() {
  const [home, site] = await Promise.all([getHome(), getSite()]);
  const meta = await buildMetadata({ seo: home.seo, path: "/" });
  // Home uses the site title verbatim rather than the "%s — Name" template.
  return { ...meta, title: { absolute: home.seo.title || site.title || site.name } };
}

export default async function Home() {
  const projects = await getProjects();
  const sheet = [...projects.filter((p) => p.featured), ...projects.filter((p) => !p.featured)].slice(0, ON_SHEET);
  return (
    <>
      <TypingPlate work={workItems(sheet)} more={projects.length} />
      <Experience />
      <Contact />
    </>
  );
}
