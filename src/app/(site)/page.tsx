import { Sections } from "@/components/sections";
import { getHome, getSite } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata() {
  const [home, site] = await Promise.all([getHome(), getSite()]);
  const meta = await buildMetadata({ seo: home.seo, path: "/" });
  // Home uses the site title verbatim rather than the "%s — Name" template.
  return { ...meta, title: { absolute: home.seo.title || site.title || site.name } };
}

export default async function Home() {
  const home = await getHome();
  return <Sections sections={home.sections} />;
}
