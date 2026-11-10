/**
 * Does an instrument stay light while it PLAYS and while it is EDITED?
 *
 * The gate `docs/memory/performance.md` is measured by. Nothing in `npm test`
 * can see this class of defect: vitest runs in node, and an editor that
 * re-renders its whole inspector on every frame of its transport, or a panel
 * that scans the 130 000-town index per stop, passes every spec and crawls on
 * a phone (2026-11-10, his report on Recap's Trip card: a click took seconds).
 *
 * Each scenario seeds its own document into the dev server's IndexedDB
 * (synthetic pictures and trips — the repository is public, nothing of his),
 * opens the editor and measures, in headless Chromium:
 * - while PLAYING: frame times (p50/p95, frames over 50 ms), long tasks, the
 *   script time per second, React commits per second and how many of them
 *   re-rendered the editor's ROOT (`rootRenders`: the number that must stay
 *   near zero — only the stage and the transport follow the playhead);
 * - while EDITING: the latency of a click, from the press to the next frame;
 * - the JS heap after a garbage collection.
 * A scenario over its budget fails the run (exit 1).
 *
 * Usage: `npm run dev` in one shell, then
 *   node scripts/check-perf.mjs [scenario…]
 * BASE overrides the dev server's address; THROTTLE=4 slows the CPU four
 * times (a phone or a tablet, roughly) — the budgets are written for it.
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// Playwright is not a dependency of the site: the project's own, else the machine's global one.
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return createRequire(join(root, 'noop.js'))('playwright');
  }
}
const { chromium } = await loadPlaywright();

const BASE = process.env.BASE ?? 'http://localhost:5173/atelier/';
const THROTTLE = Number(process.env.THROTTLE ?? 1);
const only = process.argv.slice(2);

// ---- what the page records ---------------------------------------------------------

/** Installed before the app loads: rAF frames, long tasks, React commits and root renders. */
function instrument() {
  const w = window;
  w.__perf = { commits: 0, roots: 0, long: [], frames: [], stop: true };
  // React's DevTools hook: every commit, and whether the editor's root rendered in it.
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    isDisabled: false,
    inject() {
      return 1;
    },
    onCommitFiberRoot(_id, root) {
      const p = w.__perf;
      p.commits++;
      // The editor's root component (`rootName`) rendered in this commit when its
      // CURRENT fiber carries a new hooks list: a render rebuilds the list, a
      // bail-out keeps it. The fiber is found once by a walk, then kept.
      if (!p.rootName) return;
      const isCurrent = (f) => {
        let top = f;
        while (top.return) top = top.return;
        return top.stateNode?.current === top;
      };
      let fiber = p.fiber && (isCurrent(p.fiber) ? p.fiber : p.fiber.alternate && isCurrent(p.fiber.alternate) ? p.fiber.alternate : null);
      if (!fiber) {
        const stack = [root.current];
        while (stack.length && !fiber) {
          const f = stack.pop();
          const name = typeof f.type === 'function' ? f.type.displayName || f.type.name : null;
          if (name === p.rootName) fiber = f;
          if (f.sibling) stack.push(f.sibling);
          if (f.child) stack.push(f.child);
        }
        p.fiber = fiber;
        p.seen = fiber?.memoizedState;
        return;
      }
      if (fiber.memoizedState !== p.seen) {
        p.seen = fiber.memoizedState;
        p.roots++;
      }
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    checkDCE() {},
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) w.__perf.long.push(e.duration);
  }).observe({ type: 'longtask' });
}

async function startWindow(page, rootName) {
  await page.evaluate((name) => {
    const p = window.__perf;
    Object.assign(p, { commits: 0, roots: 0, long: [], frames: [], stop: false, rootName: name });
    const loop = (t) => {
      p.frames.push(t);
      if (!p.stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, rootName);
}

async function endWindow(page) {
  return page.evaluate(() => {
    const p = window.__perf;
    p.stop = true;
    const d = p.frames
      .slice(1)
      .map((t, i) => t - p.frames[i])
      .sort((a, b) => a - b);
    return {
      commits: p.commits,
      roots: p.roots,
      longN: p.long.length,
      longMs: Math.round(p.long.reduce((a, b) => a + b, 0)),
      p50: +(d[Math.floor(d.length / 2)] ?? 0).toFixed(1),
      p95: +(d[Math.floor(d.length * 0.95)] ?? 0).toFixed(1),
      over50: d.filter((x) => x > 50).length,
    };
  });
}

async function metrics(cdp) {
  return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
}

/** Measure `act` for `ms`: frames, long tasks, script time, commits and root renders. */
async function measure(page, cdp, rootName, ms, act) {
  await cdp.send('HeapProfiler.collectGarbage');
  const m0 = await metrics(cdp);
  await startWindow(page, rootName);
  await act?.();
  await page.waitForTimeout(ms);
  const s = await endWindow(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const m1 = await metrics(cdp);
  const sec = ms / 1000;
  return {
    ...s,
    commitsPerS: Math.round(s.commits / sec),
    rootRendersPerS: +(s.roots / sec).toFixed(1),
    scriptMsPerS: Math.round(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / sec),
    heapMB: +(m1.JSHeapUsedSize / 1048576).toFixed(1),
  };
}

/** Click each target in turn, the time from the press to the next painted frame. */
async function clickLatency(page, targets) {
  const out = [];
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      document.addEventListener('pointerdown', () => (window.__t0 = performance.now()), { once: true, capture: true });
    });
    await target.click();
    out.push(await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => setTimeout(() => res(Math.round(performance.now() - window.__t0)), 0)))));
  }
  return out;
}

// ---- the seeds: synthetic, written through the dev server's own modules -------------

const PLACES = [
  ['Perth', -31.95, 115.86], ['Mandurah', -32.53, 115.72], ['Bunbury', -33.33, 115.64], ['Busselton', -33.65, 115.35],
  ['Margaret River', -33.95, 115.07], ['Augusta', -34.31, 115.16], ['Walpole', -34.98, 116.73], ['Denmark', -34.96, 117.35],
  ['Albany', -35.02, 117.88], ['Bremer Bay', -34.39, 119.38], ['Hopetoun', -33.95, 120.13], ['Esperance', -33.86, 121.89],
];

/** A twelve-place trip of two legs over October 2026; `post` adds a Reel whose opener is `post.hook`. */
async function seedTrip(page, post) {
  return page.evaluate(
    async ({ places, post }) => {
      const B = new URL('src/', document.baseURI).pathname;
      const tt = await import(`${B}shared/roadtrip/trip-types.ts`);
      const ts = await import(`${B}shared/roadtrip/trip-store.ts`);
      const trip = tt.createTripDoc('West coast', '2026-10-01', '2026-10-28');
      trip.stages = [
        tt.createTripStage('South west', 'Western Australia', '2026-10-01', '2026-10-14', places.slice(0, 6).map(([n, lat, lon]) => tt.createTripPlace(n, 'WA', { lat, lon }))),
        tt.createTripStage('South coast', 'Western Australia', '2026-10-15', '2026-10-28', places.slice(6).map(([n, lat, lon]) => tt.createTripPlace(n, 'WA', { lat, lon }))),
      ];
      if (post) {
        const p = tt.createTripPost('reel', '2026-10-27', 'Perf');
        p.slides[0].hook = [{ id: post.hook, options: {} }];
        trip.posts = [p];
      }
      await ts.putTrip(trip);
      return { trip, postId: trip.posts[0]?.id ?? null };
    },
    { places: PLACES, post },
  );
}

/** A month recap over October 2026: `n` located pictures, their prints kept, its opener `opener`. */
async function seedRecap(page, n, opener) {
  return page.evaluate(
    async ({ places, n, opener }) => {
      const B = new URL('src/', document.baseURI).pathname;
      const rd = await import(`${B}shared/recap/recap-doc.ts`);
      const rs = await import(`${B}tools/recap/recap-store.ts`);
      const ro = await import(`${B}shared/recap/recap-opener.ts`);
      const rot = await import(`${B}shared/recap/recap-opener-trip.ts`);
      const ts = await import(`${B}shared/roadtrip/trip-store.ts`);
      const trip = (await ts.listTrips()).find((t) => t.name === 'West coast');
      let doc = rd.createRecapDoc('month', 'local', { title: 'October', anchor: '2026-10-01' });
      const pics = [];
      for (let i = 0; i < n; i++) {
        const [place, lat, lon] = places[Math.floor((i / n) * places.length)];
        const day = `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`;
        pics.push({ key: `p:${i}`, origin: 'local', name: `IMG_${i}.jpg`, kind: 'photo', day, minute: 600 + i * 7, width: 1500, height: 1000, device: 'ILCE-7M4', focal: 35, lat: lat + i * 0.001, lon: lon + i * 0.001, place, region: 'Western Australia', country: 'Australia' });
        const c = new OffscreenCanvas(1500, 1000);
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 1500, 1000);
        grad.addColorStop(0, `hsl(${(i * 37) % 360} 50% 55%)`);
        grad.addColorStop(1, `hsl(${(i * 37 + 120) % 360} 40% 25%)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, 1500, 1000);
        await rs.putPrint(`p:${i}`, await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
      }
      doc = rd.withPictures(doc, pics);
      doc = rd.withRecap(doc, { opener: { ...ro.readOpener({ kind: opener }), ...(trip ? { tripCopy: rot.openerTripFrom(trip) } : {}) } });
      await rs.putRecap(doc);
      return { id: doc.id };
    },
    { places: PLACES, n, opener },
  );
}

// ---- the scenarios ------------------------------------------------------------------

/**
 * Budgets, at THROTTLE=4 (a phone, roughly). Playing: the editor's root
 * re-renders at most twice a second (a page turned, a slide changed — never
 * per frame), frames p95 under 70 ms, under 400 ms of long tasks in the
 * window. Editing: a click painted within 400 ms. At THROTTLE=1 a quarter of
 * each time.
 */
const k = Math.max(1, THROTTLE) / 4;
const BUDGET = { rootRendersPerS: 2, p95: 70 * Math.max(k, 0.25), longMs: 400 * k, click: 400 * Math.max(k, 0.25) };

const SCENARIOS = {
  /** Recap, a month with its Trip card opener, the card's chapter open: the 2026-11-10 report. */
  async 'recap-trip-card'(page, cdp) {
    await seedTrip(page, null);
    const { id } = await seedRecap(page, 28, 'card');
    await page.goto(new URL(`#/recap/october-${id.slice(0, 8)}`, BASE).href);
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Motion', exact: true }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Card/ }).filter({ hasText: 'Trace' }).first().click();
    await page.waitForTimeout(1500);
    const play = await measure(page, cdp, 'RecapEditor', 4000, () => page.locator('button', { hasText: /Play the opener/ }).first().click());
    await page.keyboard.press('Space').catch(() => undefined);
    await page.waitForTimeout(500);
    const faces = page.getByRole('group', { name: 'The card’s face' });
    const clicks = await clickLatency(page, ['Passport', 'Trace', 'Ticket', 'Trace'].map((n) => faces.getByRole('button', { name: n })));
    return { play, clicks };
  },
  /** Recap, the whole film playing with a Badge opener, the Pictures tab in view. */
  async 'recap-film'(page, cdp) {
    const { id } = await seedRecap(page, 28, 'badge');
    await page.goto(new URL(`#/recap/october-${id.slice(0, 8)}`, BASE).href);
    await page.waitForTimeout(3000);
    const play = await measure(page, cdp, 'RecapEditor', 4000, () => page.keyboard.press('Space'));
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    const tabs = ['Text', 'Layout', 'Motion', 'Pictures'].map((n) => page.getByRole('button', { name: n, exact: true }));
    const clicks = await clickLatency(page, tabs);
    return { play, clicks };
  },
  /** Trips, a Reel whose opener is a Virée over the twelve places, playing. */
  async 'trips-viree'(page, cdp) {
    const { trip, postId } = await seedTrip(page, { hook: 'drive' });
    await page.goto(new URL(`#/roadtrip/west-coast-${trip.id.slice(0, 8)}/2026-10-27/${postId}`, BASE).href);
    await page.waitForTimeout(4000);
    const play = await measure(page, cdp, 'PostEditor', 4000, () => page.keyboard.press('Space'));
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    return { play };
  },
};

// ---- the run ------------------------------------------------------------------------

const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
let failed = false;
for (const [name, run] of Object.entries(SCENARIOS)) {
  if (only.length && !only.includes(name)) continue;
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(instrument);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(new URL('#/recap/home', BASE).href);
  await page.waitForTimeout(1500);
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  let result;
  try {
    result = await run(page, cdp);
  } catch (err) {
    console.log(`✗ ${name}: ${String(err).split('\n')[0]}`);
    failed = true;
    await context.close();
    continue;
  }
  const over = [];
  if (result.play) {
    if (result.play.rootRendersPerS > BUDGET.rootRendersPerS) over.push(`the editor re-renders ${result.play.rootRendersPerS}/s while playing (≤ ${BUDGET.rootRendersPerS})`);
    if (result.play.p95 > BUDGET.p95) over.push(`frame p95 ${result.play.p95} ms (≤ ${BUDGET.p95})`);
    if (result.play.longMs > BUDGET.longMs) over.push(`${result.play.longMs} ms of long tasks (≤ ${BUDGET.longMs})`);
  }
  if (result.clicks && Math.max(...result.clicks) > BUDGET.click) over.push(`a click took ${Math.max(...result.clicks)} ms (≤ ${BUDGET.click})`);
  if (errors.length) over.push(`page errors: ${errors.slice(0, 2).join(' | ')}`);
  console.log(`${over.length ? '✗' : '✓'} ${name}${THROTTLE > 1 ? ` (CPU ×${THROTTLE})` : ''}`);
  if (result.play) console.log(`    playing: ${JSON.stringify(result.play)}`);
  if (result.clicks) console.log(`    clicks (ms): ${result.clicks.join(', ')}`);
  for (const o of over) console.log(`    over budget: ${o}`);
  if (over.length) failed = true;
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
