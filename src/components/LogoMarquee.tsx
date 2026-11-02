import styles from "./experience.module.css";

/** who the work was for: a mark each (public/logos, one colour, painted in the text's), its
    width for a given height from its viewBox; Citarella has no vector mark, so it is set */
const LOGOS: { name: string; file?: string; ratio: number; scale?: number }[] = [
  { name: "Coca-Cola", file: "coca-cola", ratio: 615.11 / 192.95, scale: 1.25 },
  { name: "Boy Scouts of America", file: "boy-scouts", ratio: 225.44 / 253.41, scale: 1.5 },
  { name: "Citarella", ratio: 0 },
  { name: "Citi", file: "citi", ratio: 55.93 / 32.11, scale: 1.2 },
  { name: "HSBC", file: "hsbc", ratio: 315.9 / 85.1 },
  { name: "Lionsgate", file: "lionsgate", ratio: 300.01 / 38.04, scale: 0.8 },
  { name: "Science Inc.", file: "science-inc", ratio: 177.73 / 45.86 },
];

function Row({ hidden }: { hidden?: boolean }) {
  return (
    <ul className={styles.logos} aria-hidden={hidden || undefined}>
      {LOGOS.map((l) => (
        <li key={l.name}>
          {l.file ? (
            <span
              className={styles.logo}
              role={hidden ? undefined : "img"}
              aria-label={hidden ? undefined : l.name}
              style={{ "--src": `url(/logos/${l.file}.svg)`, "--r": l.ratio, "--s": l.scale ?? 1 } as React.CSSProperties}
            />
          ) : (
            <span className={styles.wordmark}>{l.name}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** the marks go by, twice over so the loop never shows its seam; held while pointed at. Moving,
    they keep their own glyphs (data-ink-skip): the ink layer only draws what stands still */
export default function LogoMarquee() {
  return (
    <div className={styles.marquee} role="group" aria-label="Clients" data-ink-skip>
      <div className={styles.track}>
        <Row />
        <Row hidden />
      </div>
    </div>
  );
}
