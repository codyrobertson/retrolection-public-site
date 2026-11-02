import { getSite } from "@/lib/content";
import ContactForm from "./ContactForm";
import LiveInk from "./LiveInk";
import styles from "./contact.module.css";

/**
 * Plate 04, back on the light stock with the foot of the page: a note to me. The form is the
 * box's mono on ruled lines; its words in the page's ink, what's typed into it in the reader's own (DOM) hand.
 */
export default async function Contact() {
  const site = await getSite();
  const email = site.social.find((s) => s.platform === "email")?.url.replace(/^mailto:/, "");
  return (
    <section id="contact" className={styles.section} aria-labelledby="contact-title">
      <LiveInk id="ink-contact-gl" className={styles.inner}>
        <p className={styles.label}>
          <span>04 / Contact</span>
          <span>Phoenix, AZ</span>
        </p>
        <h2 id="contact-title" className={styles.title}>Tell me what you&rsquo;re making.</h2>
        <p className={styles.summary}>
          A product, a brand, a launch, or something that doesn&rsquo;t have a name yet. A few lines is plenty.
        </p>
        <ContactForm email={email} />
      </LiveInk>
    </section>
  );
}
