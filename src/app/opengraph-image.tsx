import { getSite } from "@/lib/content";
import { ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "Social card";

export default async function Image() {
  const site = await getSite();
  return ogImage({ title: site.title || site.name, kicker: site.jobTitle || undefined, name: site.name });
}
