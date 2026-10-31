import localFont from "next/font/local";

/*
 * Type faces, self-hosted from src/fonts/.
 *
 *   Messina Sans  headlines and UI          --font-messina → --font-sans
 *   Inferi        body text                 --font-inferi  → --font-serif
 *   MD Nichrome   captions, meta, labels    --font-nichrome → --font-small
 *
 * Demo only: the Inferi and MD Nichrome files are trial cuts with a reduced
 * character set (no hyphen, quotes, dashes, accents…); missing glyphs fall back
 * to the next font in the stack. Swap in licensed files before launch.
 */

export const messina = localFont({
  src: [
    { path: "../fonts/messina-sans-300.woff2", weight: "300" },
    { path: "../fonts/messina-sans-400.woff2", weight: "400" },
    { path: "../fonts/messina-sans-700.woff2", weight: "700" },
  ],
  variable: "--font-messina",
  display: "swap",
});

export const inferi = localFont({
  src: [
    { path: "../fonts/inferi-300.woff2", weight: "300" },
    { path: "../fonts/inferi-400.woff2", weight: "400" },
    { path: "../fonts/inferi-400-italic.woff2", weight: "400", style: "italic" },
    { path: "../fonts/inferi-500.woff2", weight: "500" },
    { path: "../fonts/inferi-600.woff2", weight: "600" },
    { path: "../fonts/inferi-700.woff2", weight: "700" },
  ],
  variable: "--font-inferi",
  display: "swap",
});

export const nichrome = localFont({
  src: [
    { path: "../fonts/md-nichrome-300.woff2", weight: "300" },
    { path: "../fonts/md-nichrome-400.woff2", weight: "400" },
    { path: "../fonts/md-nichrome-700.woff2", weight: "700" },
  ],
  variable: "--font-nichrome",
  display: "swap",
});
