import { PASTE } from './scene.js';

// The hero the plate sets in its box. The hands type a dateline (the visitor's own day and
// time) and the heading, press Ctrl+V and the line under it is pasted in whole, then type
// each link as a shortcode, `[button, Label]`, that becomes the button when Return goes down.
// The eyebrow sits in the box's corner from the start.
// The page passes its own hero (content/home.yaml); this is the same copy, for the check
// script and for a page that renders the plate without one.
export const HERO = {
  eyebrow: 'Design Engineer · Phoenix, AZ',
  heading: 'I design and build AI-native products.',
  subheading: 'Creative director turned design engineer. From crypto to AI-native solutions: the brand, the product, and the code behind it.',
  links: [
    { label: 'See Projects', href: '#work' },
    { label: 'View GitHub', href: 'https://github.com/codyrobertson' },
  ],
};
/** the dateline: the reader's weekday and time, as the hands type it */
export const stampOf = (d = new Date()) =>
  `${d.toLocaleDateString('en-US', { weekday: 'long' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
/** a link as the hands type it */
export const shortcodeOf = (link) => `[button, ${link.label}]`;
/** the lines the hands type, top to bottom, joined by Returns: dateline, heading, the paste,
 * the shortcodes; and an empty last line, for the Return that renders the last shortcode */
export const linesOf = (hero, stamp) => {
  const links = hero.links || [];
  const lines = [stamp, hero.heading, hero.subheading ? PASTE : '', ...links.map(shortcodeOf)].filter(Boolean);
  return links.length ? [...lines, ''] : lines;
};
// a fixed stamp, so the check script sees the same performance every run
export const TYPED = linesOf(HERO, 'Wednesday, 10:42 AM').join('\n');
