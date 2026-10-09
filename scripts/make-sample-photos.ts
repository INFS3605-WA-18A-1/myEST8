// Draws the demo's sample photos: small illustrative JPEGs of the issues in the
// demo stories, so seeded Maintenance Requests show real images instead of
// broken ones. Each scene is an SVG screenshotted by Chromium. The output is
// committed under src/demo/sample-photos/; run this again only to redraw them.
//
//   npx tsx scripts/make-sample-photos.ts [--out src/demo/sample-photos]
//
// The demo adds EXIF (when and where the photo was "taken") at seed time.

import { mkdirSync, statSync } from 'node:fs';
import { chromium } from 'playwright';

const WIDTH = 480;
const HEIGHT = 360;
const MAX_BYTES = 40 * 1024;

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1]! : 'src/demo/sample-photos';

/** A soft vignette and grain, so the flat drawings read a little more like phone photos. */
const FINISH = `
  <defs>
    <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
      <stop offset="60%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.35"/>
    </radialGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="3"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.06 0"/></filter>
  </defs>`;
const OVERLAY = `<rect width="${WIDTH}" height="${HEIGHT}" filter="url(#grain)"/><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)"/>`;

const tiles = (fill: string, grout: string, size: number) =>
  `<pattern id="tiles" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><rect width="${size}" height="${size}" fill="${grout}"/><rect x="1.5" y="1.5" width="${size - 3}" height="${size - 3}" fill="${fill}" rx="1"/></pattern>`;

/** Each scene's SVG body, drawn on a 480×360 canvas. */
const SCENES: Record<string, string> = {
  'dripping-tap': `
    <defs>${tiles('#eef1f3', '#c9cfd4', 60)}
      <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f9fa"/><stop offset="0.45" stop-color="#9aa4ab"/><stop offset="0.55" stop-color="#d9dee2"/><stop offset="1" stop-color="#6c767d"/></linearGradient>
      <linearGradient id="bowl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6dadd"/></linearGradient>
      <radialGradient id="drop" cx="40%" cy="35%" r="60%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#7fb2d9"/></radialGradient>
    </defs>
    <rect width="480" height="360" fill="url(#tiles)"/>
    <rect x="0" y="250" width="480" height="110" fill="#e4e1db"/>
    <path d="M40 250 Q240 380 440 250 Z" fill="url(#bowl)" stroke="#c2c6c9" stroke-width="2"/>
    <ellipse cx="240" cy="292" rx="16" ry="5" fill="#8d969c"/>
    <rect x="215" y="120" width="50" height="70" rx="8" fill="url(#chrome)"/>
    <path d="M232 135 h120 q22 0 22 22 v20 h-24 v-14 q0 -6 -6 -6 h-112 z" fill="url(#chrome)"/>
    <rect x="200" y="95" width="80" height="22" rx="11" fill="url(#chrome)"/>
    <ellipse cx="362" cy="200" rx="6" ry="9" fill="url(#drop)"/>
    <ellipse cx="362" cy="238" rx="5" ry="8" fill="url(#drop)" opacity="0.9"/>
    <ellipse cx="362" cy="285" rx="22" ry="5" fill="none" stroke="#9cc3e0" stroke-width="2" opacity="0.8"/>`,

  'basin-drain': `
    <defs><radialGradient id="basin" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd5d9"/></radialGradient>
      <radialGradient id="water" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#b9c7bf" stop-opacity="0.9"/><stop offset="1" stop-color="#93a69b" stop-opacity="0.7"/></radialGradient></defs>
    <rect width="480" height="360" fill="#b9a68b"/>
    <rect width="480" height="360" fill="#d9cfc0" opacity="0.6"/>
    <ellipse cx="240" cy="185" rx="200" ry="140" fill="#f4f4f2" stroke="#c8c8c3" stroke-width="3"/>
    <ellipse cx="240" cy="190" rx="165" ry="112" fill="url(#basin)"/>
    <ellipse cx="240" cy="205" rx="130" ry="80" fill="url(#water)"/>
    <ellipse cx="200" cy="190" rx="40" ry="8" fill="#ffffff" opacity="0.35"/>
    <circle cx="240" cy="215" r="18" fill="#7d8a84"/>
    <circle cx="240" cy="215" r="12" fill="#5c6863"/>
    <path d="M228 215 h24 M240 203 v24" stroke="#46504b" stroke-width="3"/>
    <rect x="215" y="40" width="50" height="40" rx="6" fill="#aeb7bd"/>`,

  'water-stain': `
    <defs><radialGradient id="stain" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#b7965d" stop-opacity="0.75"/><stop offset="0.6" stop-color="#c9ad7a" stop-opacity="0.55"/><stop offset="0.85" stop-color="#9c7a45" stop-opacity="0.65"/><stop offset="1" stop-color="#e9e4d8" stop-opacity="0"/></radialGradient>
      <linearGradient id="ceiling" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1eee7"/><stop offset="1" stop-color="#d8d3c8"/></linearGradient></defs>
    <rect width="480" height="360" fill="url(#ceiling)"/>
    <path d="M150 90 C220 40 330 70 350 130 C380 210 300 270 220 250 C140 235 90 160 150 90 Z" fill="url(#stain)"/>
    <path d="M190 120 C240 95 300 115 305 160 C310 205 250 225 210 210 C170 195 160 140 190 120 Z" fill="#a8864f" opacity="0.35"/>
    <path d="M150 90 C220 40 330 70 350 130 C380 210 300 270 220 250 C140 235 90 160 150 90 Z" fill="none" stroke="#8a6a3a" stroke-width="3" opacity="0.5"/>
    <path d="M0 330 L480 300" stroke="#cfc9bb" stroke-width="10"/>
    <circle cx="390" cy="250" r="34" fill="#fbfaf6" stroke="#cfc9bb" stroke-width="3"/>
    <circle cx="390" cy="250" r="20" fill="#ffffff"/>`,

  'light-switch': `
    <defs><linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8dcc8"/><stop offset="1" stop-color="#cdbfa7"/></linearGradient></defs>
    <rect width="480" height="360" fill="url(#wall)"/>
    <rect x="160" y="70" width="160" height="220" rx="10" fill="#f8f7f3" stroke="#bdb6a8" stroke-width="2"/>
    <path d="M160 180 L215 150 L240 190 L290 160 L320 175" stroke="#8d877c" stroke-width="2" fill="none"/>
    <rect x="215" y="120" width="50" height="50" rx="4" fill="#efede7" stroke="#b9b3a6" stroke-width="2" transform="rotate(18 240 145)"/>
    <rect x="223" y="200" width="34" height="56" rx="4" fill="#eceae4" stroke="#b9b3a6" stroke-width="2"/>
    <path d="M238 172 q-10 25 6 40 q14 14 -4 30" stroke="#c0392b" stroke-width="4" fill="none"/>
    <path d="M246 172 q12 30 -2 46" stroke="#2c3e50" stroke-width="4" fill="none"/>
    <circle cx="185" cy="95" r="5" fill="#b9b3a6"/><circle cx="295" cy="265" r="5" fill="#b9b3a6"/>`,

  'window-mould': `
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fc4e4"/><stop offset="1" stop-color="#dbe9f3"/></linearGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="3"/></filter><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
      <filter id="speckle"><feTurbulence type="fractalNoise" baseFrequency="0.14" numOctaves="3" seed="7"/><feColorMatrix values="0 0 0 0 0.13  0 0 0 0 0.16  0 0 0 0 0.12  7 0 0 0 -3.6"/></filter>
      <mask id="mouldy"><g filter="url(#soft)" fill="#fff"><ellipse cx="160" cy="262" rx="110" ry="22"/><ellipse cx="330" cy="268" rx="80" ry="18"/><ellipse cx="84" cy="190" rx="16" ry="80"/><ellipse cx="396" cy="210" rx="12" ry="50"/></g></mask></defs>
    <rect width="480" height="360" fill="#e7e2d8"/>
    <rect x="70" y="30" width="340" height="250" fill="#f6f4ef" stroke="#cfc9bd" stroke-width="3"/>
    <rect x="95" y="52" width="290" height="200" fill="url(#sky)"/>
    <rect x="236" y="52" width="10" height="200" fill="#f6f4ef"/>
    <rect x="95" y="148" width="290" height="8" fill="#f6f4ef"/>
    <rect x="50" y="270" width="380" height="34" fill="#f2efe8" stroke="#cfc9bd" stroke-width="2"/>
    <g filter="url(#blur)" fill="#4b4a33" opacity="0.45"><ellipse cx="140" cy="262" rx="70" ry="14"/><ellipse cx="300" cy="266" rx="90" ry="12"/><ellipse cx="84" cy="200" rx="12" ry="60"/></g>
    <rect width="480" height="360" filter="url(#speckle)" mask="url(#mouldy)"/>
    <path d="M110 250 q20 -14 40 0 q20 14 40 0" stroke="#6b5a3a" stroke-width="3" fill="none" opacity="0.5"/>`,

  'power-point': `
    <defs><linearGradient id="wall2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1ece2"/><stop offset="1" stop-color="#d7d0c2"/></linearGradient>
      <radialGradient id="scorch" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#3b2a1a" stop-opacity="0.85"/><stop offset="1" stop-color="#3b2a1a" stop-opacity="0"/></radialGradient></defs>
    <rect width="480" height="360" fill="url(#wall2)"/>
    <rect x="0" y="300" width="480" height="60" fill="#a88a63"/>
    <rect x="110" y="90" width="260" height="150" rx="12" fill="#fbfaf7" stroke="#c9c2b5" stroke-width="2"/>
    <ellipse cx="185" cy="165" rx="48" ry="40" fill="url(#scorch)"/>
    <g fill="#3a3a3a"><rect x="168" y="140" width="7" height="22" transform="rotate(30 171 151)"/><rect x="196" y="140" width="7" height="22" transform="rotate(-30 199 151)"/><rect x="181" y="170" width="7" height="20"/></g>
    <g fill="#3a3a3a"><rect x="278" y="140" width="7" height="22" transform="rotate(30 281 151)"/><rect x="306" y="140" width="7" height="22" transform="rotate(-30 309 151)"/><rect x="291" y="170" width="7" height="20"/></g>
    <rect x="160" y="205" width="28" height="14" rx="3" fill="#e6e1d8" stroke="#b5ad9f"/><rect x="270" y="205" width="28" height="14" rx="3" fill="#e6e1d8" stroke="#b5ad9f"/>
    <rect x="166" y="208" width="10" height="8" fill="#c0392b"/><rect x="276" y="208" width="10" height="8" fill="#7f8c8d"/>`,

  'hot-water-leak': `
    <defs><linearGradient id="tank" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9aa3a8"/><stop offset="0.35" stop-color="#e3e7ea"/><stop offset="1" stop-color="#8b9499"/></linearGradient>
      <radialGradient id="puddle" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#8fb6cf" stop-opacity="0.8"/><stop offset="1" stop-color="#8fb6cf" stop-opacity="0"/></radialGradient></defs>
    <rect width="480" height="360" fill="#d6d2c9"/>
    <rect x="0" y="270" width="480" height="90" fill="#9b9488"/>
    <rect x="160" y="20" width="160" height="270" rx="30" fill="url(#tank)"/>
    <rect x="160" y="70" width="160" height="10" fill="#7e878c" opacity="0.5"/>
    <rect x="200" y="120" width="80" height="60" rx="4" fill="#f7f7f5" stroke="#9aa3a8"/>
    <rect x="210" y="132" width="60" height="6" fill="#c0392b"/><rect x="210" y="146" width="40" height="4" fill="#7f8c8d"/><rect x="210" y="156" width="50" height="4" fill="#7f8c8d"/>
    <path d="M200 10 v20 M280 10 v20" stroke="#b87333" stroke-width="10"/>
    <ellipse cx="250" cy="312" rx="170" ry="30" fill="url(#puddle)"/>
    <path d="M300 280 q6 12 0 20" stroke="#8fb6cf" stroke-width="4" fill="none"/>
    <ellipse cx="300" cy="303" rx="8" ry="3" fill="#8fb6cf"/>`,

  oven: `
    <defs><linearGradient id="steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dcde"/><stop offset="1" stop-color="#9ea3a6"/></linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2f33"/><stop offset="1" stop-color="#14171a"/></linearGradient></defs>
    <rect width="480" height="360" fill="#e9e3d6"/>
    <rect x="70" y="20" width="340" height="320" fill="url(#steel)" stroke="#8a8f92" stroke-width="2"/>
    <rect x="70" y="20" width="340" height="50" fill="#2a2d30"/>
    <circle cx="120" cy="45" r="12" fill="#c9cdd0"/><circle cx="160" cy="45" r="12" fill="#c9cdd0"/><circle cx="320" cy="45" r="12" fill="#c9cdd0"/><circle cx="360" cy="45" r="12" fill="#c9cdd0"/>
    <rect x="220" y="36" width="44" height="18" rx="3" fill="#0f2b1a"/><text x="242" y="50" font-family="monospace" font-size="13" fill="#3ddc84" text-anchor="middle">0:00</text>
    <rect x="95" y="90" width="290" height="20" rx="10" fill="#c6cacd"/>
    <rect x="100" y="125" width="280" height="190" rx="10" fill="url(#glass)"/>
    <path d="M130 270 h220 M130 270 q-10 0 -10 -10 M350 270 q10 0 10 -10" stroke="#3a3f44" stroke-width="5" fill="none"/>
    <path d="M140 160 h200" stroke="#555b60" stroke-width="3"/>
    <path d="M110 140 L170 300" stroke="#ffffff" stroke-width="10" opacity="0.06"/>`,

  'cupboard-leak': `
    <defs><linearGradient id="board" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e9e4da"/><stop offset="1" stop-color="#d5cec0"/></linearGradient></defs>
    <rect width="480" height="360" fill="#3d362e"/>
    <rect x="40" y="20" width="400" height="320" fill="url(#board)"/>
    <rect x="60" y="40" width="360" height="280" fill="#cfc6b6"/>
    <path d="M200 40 v80 q0 30 30 30 h30 q30 0 30 -30 v-80" stroke="#bfc4c7" stroke-width="16" fill="none"/>
    <path d="M245 150 v80 h-120" stroke="#aeb4b8" stroke-width="14" fill="none"/>
    <circle cx="245" cy="150" r="12" fill="#8e979c"/>
    <path d="M251 160 q4 10 0 16" stroke="#7fb2d9" stroke-width="4" fill="none"/>
    <ellipse cx="250" cy="300" rx="120" ry="16" fill="#8fb6cf" opacity="0.6"/>
    <path d="M60 300 q60 -14 120 0 q60 14 120 0 q60 -14 120 0 v20 h-360 z" fill="#b9a98c"/>
    <path d="M70 296 l30 -10 l20 14 l40 -12" stroke="#7a6b52" stroke-width="2" fill="none"/>`,

  receipt: `
    <rect width="480" height="360" fill="#6f6a63"/>
    <g transform="rotate(-3 240 180)">
      <rect x="110" y="10" width="260" height="345" fill="#fbfaf5"/>
      <g font-family="'Courier New', monospace" fill="#2b2b2b" font-size="13">
        <text x="240" y="40" text-anchor="middle" font-size="17" font-weight="bold">DRIP DOCTORS</text>
        <text x="240" y="58" text-anchor="middle" font-size="11">Plumbing &amp; Gas · Lic. 123456C</text>
        <text x="240" y="84" text-anchor="middle" font-weight="bold">TAX INVOICE</text>
        <text x="125" y="112">Emergency call-out</text><text x="355" y="112" text-anchor="end">$180.00</text>
        <text x="125" y="132">(after hours)</text>
        <text x="125" y="156">Replace burst pipe</text><text x="355" y="156" text-anchor="end">$245.00</text>
        <text x="125" y="176">under laundry tub</text>
        <text x="125" y="200">Parts &amp; fittings</text><text x="355" y="200" text-anchor="end">incl.</text>
        <path d="M125 216 h230" stroke="#2b2b2b" stroke-dasharray="4 3"/>
        <text x="125" y="240" font-weight="bold">TOTAL (incl GST)</text><text x="355" y="240" text-anchor="end" font-weight="bold">$425.00</text>
        <text x="125" y="262" font-size="11">GST included</text><text x="355" y="262" text-anchor="end" font-size="11">$38.64</text>
        <text x="240" y="300" text-anchor="middle" font-size="12">PAID - EFTPOS</text>
        <text x="240" y="330" text-anchor="middle" font-size="11">Thank you!</text>
      </g>
    </g>`,
};

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  for (const [name, body] of Object.entries(SCENES)) {
    await page.setContent(
      `<!doctype html><html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${FINISH}${body}${OVERLAY}</svg></body></html>`,
    );
    const path = `${out}/${name}.jpg`;
    await page.screenshot({ path, type: 'jpeg', quality: 70 });
    const bytes = statSync(path).size;
    console.log(`${path} ${(bytes / 1024).toFixed(1)} KB`);
    if (bytes > MAX_BYTES) throw new Error(`${path} is over ${MAX_BYTES / 1024} KB`);
  }
} finally {
  await browser.close();
}
