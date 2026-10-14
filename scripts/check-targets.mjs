/**
 * Is every target grabbed on 44 px under a finger, and does no target's zone
 * reach over another's? (`docs/touch-targets.md`, T1 and T4.)
 *
 * The zones are `::after` pseudo-elements (`.touch-row`, `.touch-halo` in
 * `src/index.css`), so this reads them where the browser lays them out: at
 * 390 px with touch, every visible target's ZONE is its box grown by its
 * `::after`. A zone under 44 px in either direction is SHORT; two zones that
 * overlap — where a finger may get the wrong one — CLASH. Measured in the
 * page's own frame, which scrolling does not change between two targets.
 *
 * Usage: `npm run dev` in one shell, then
 *   node scripts/check-targets.mjs
 * with BASE set if the dev server is not on 5173, and SCREENS a comma list
 * of `route>tab>tab` paths to sweep (default: Flight Atlas's tabs, which need
 * no media). It prints a line per screen and the targets that fall short; it
 * exits non-zero on a clash, never on a short target: a row's icon button
 * is 34 px wide by design, its neighbours too close for a wider zone.
 */
import { chromium } from 'playwright';

const EXE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173/atelier/';
const SCREENS = (process.env.SCREENS ?? 'atlas>Flights,atlas>Style,atlas>Motion,atlas>Camera,atlas>Overlay,atlas>Format,atlas>Export')
  .split(',')
  .map((s) => s.split('>'));

const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await context.newPage();
let clashes = 0;

for (const [route, ...tabs] of SCREENS) {
  await page.goto(`${BASE}#/${route}`);
  await page.waitForTimeout(1500);
  for (const tab of tabs) {
    await page.getByRole('button', { name: tab, exact: true }).first().click();
    await page.waitForTimeout(250);
  }
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  const report = await page.evaluate(() => {
    // A checkbox is grabbed by the label it lives in, so the label is measured.
    const SEL = 'button, a[href], [role="switch"], [role="checkbox"], input[type="checkbox"]:not(label input), label:has(input[type="checkbox"]), select, [role="slider"][tabindex]';
    // A target's ZONE: its box, grown by its `::after` where one is drawn.
    const zoneOf = (el) => {
      const r = el.getBoundingClientRect();
      const z = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      const a = getComputedStyle(el, '::after');
      if (a.content !== 'none' && a.position === 'absolute') {
        const px = (v) => (v.endsWith('px') ? parseFloat(v) : null);
        const t = px(a.top), b = px(a.bottom), l = px(a.left), rr = px(a.right);
        if (t !== null) z.top = Math.min(z.top, r.top + t);
        if (b !== null) z.bottom = Math.max(z.bottom, r.bottom - b);
        if (l !== null) z.left = Math.min(z.left, r.left + l);
        if (rr !== null) z.right = Math.max(z.right, r.right - rr);
      }
      return z;
    };
    const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    const all = [...document.querySelectorAll(SEL)].filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && !el.closest('[aria-hidden="true"], [inert]');
    });
    // Measured in the document's frame: scroll offsets cancel, so one pass sees every target.
    // Two targets can only be confused inside ONE scrolling box: content
    // scrolled under a fixed bar is not under the finger with it.
    const boxOf = (el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.position === 'fixed' || /(auto|scroll)/.test(cs.overflowY + cs.overflowX)) return n;
      }
      return document.documentElement;
    };
    const zones = all.map((el) => ({ el, z: zoneOf(el), box: boxOf(el) }));
    const out = { count: zones.length, short: [], clash: [] };
    for (const { el, z } of zones) {
      const w = z.right - z.left, h = z.bottom - z.top;
      if (Math.min(w, h) < 43.5) out.short.push(`${name(el)} (${Math.round(w)}×${Math.round(h)})`);
    }
    for (let i = 0; i < zones.length; i++)
      for (let j = i + 1; j < zones.length; j++) {
        const a = zones[i], b = zones[j];
        if (a.box !== b.box || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ox = Math.min(a.z.right, b.z.right) - Math.max(a.z.left, b.z.left);
        const oy = Math.min(a.z.bottom, b.z.bottom) - Math.max(a.z.top, b.z.top);
        if (ox > 1 && oy > 1) out.clash.push(`${name(a.el)} ↔ ${name(b.el)} (${Math.round(ox)}×${Math.round(oy)})`);
      }
    return out;
  });
  clashes += report.clash.length;
  console.log(`${[route, ...tabs].join(' › ')}${coarse ? '' : ' (NOT coarse)'}: ${report.count} targets, ${report.short.length} short, ${report.clash.length} clashes`);
  for (const s of report.short) console.log(`  short  ${s}`);
  for (const c of report.clash) console.log(`  CLASH  ${c}`);
}

await browser.close();
process.exit(clashes ? 1 : 0);
