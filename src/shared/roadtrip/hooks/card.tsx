/**
 * «&nbsp;Recap card&nbsp;» — the summary card on a slide of its own, with no
 * car (2026-10-08, the last step of the lab «la carte récap»): the end of a
 * carousel, or the piece's thumbnail, exported as a PNG by the deck like any
 * slide.
 *
 * The same model and painter as Virée's card (`summary-card.ts`,
 * `summary-paint.ts`), over the same road: the trip's legs up to the piece's
 * day, dated by the recap's clock, so the two cards of one trip say the same
 * numbers. A `layer`: on a Photo ground the slide's own picture is under it,
 * veiled. The badge is never on screen with a card, so it is hidden on its
 * slide.
 */

import { DRIVE_DEFAULTS, driveOptions, drivePlan, driveRoute } from './drive-plan';
import type { HookPanelProps, HookRender, HookVariant } from './hook-variant';
import { loadLook } from './look-text';
import { SUMMARY_WORDS } from './drive-paint';
import { CARD_DEFAULTS, cardScene, readCardOptions, type CardOptions } from './summary-card';
import { CARD_COUNT_SECONDS, CARD_RISE_SECONDS, paintCard } from './summary-paint';
import { SummaryCardRows } from './summary-card-panel';
import { Group } from './panel-ui';

/** What the card reads of the drive's options: the legs, no pictures of its own. */
function roadOptions(options: Readonly<Record<string, unknown>>) {
  return driveOptions({ ...DRIVE_DEFAULTS, ...readCardOptions(options), stopsOn: 'places', pictures: 'none', groupKm: 0 });
}

function planFor(options: Readonly<Record<string, unknown>>, ctx: HookPanelProps['ctx']) {
  const o = roadOptions(options);
  const route = driveRoute(ctx.stages ?? [], ctx.calendar ?? [], ctx.date, o, ctx.writing, ctx.towns ?? null);
  return { o, plan: drivePlan(route, o, true) };
}

function CardSketch() {
  return (
    <span className="relative block w-[3.6rem] h-[1.4rem] rounded-[3px] overflow-hidden" style={{ background: '#15110b' }} aria-hidden="true">
      <svg viewBox="0 0 58 22" width="58" height="22" className="absolute inset-0" fill="none">
        <path d="M8 5 C 18 8, 22 14, 30 12 S 44 6, 50 15" stroke="#f2c230" strokeWidth="1.3" strokeLinecap="round" />
        <rect x="9" y="17" width="9" height="2" rx="1" fill="#f2c230" opacity="0.8" />
        <rect x="24" y="17" width="9" height="2" rx="1" fill="#f2c230" opacity="0.8" />
        <rect x="39" y="17" width="9" height="2" rx="1" fill="#f2c230" opacity="0.8" />
      </svg>
    </span>
  );
}

function CardPanel({ options, onChange, ctx }: HookPanelProps) {
  const card = readCardOptions(options);
  const { o, plan } = planFor(options, ctx);
  const set = (patch: Partial<CardOptions>) => onChange({ ...card, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-xs text-ink-soft">
        {plan
          ? `The trip’s road up to this piece’s day: ${plan.route.stops.length} places on its legs. The badge is hidden on this slide.`
          : 'No leg of the trip up to this day carries two located places — the card has no road to tell.'}
      </p>
      <Group title="Summary card">
        <SummaryCardRows o={{ ...o, ...card }} set={set} plan={plan} ctx={ctx} badge={false} />
      </Group>
    </div>
  );
}

export const cardVariant: HookVariant = {
  id: 'card',
  name: 'Recap card',
  tagline: 'The trip told on one card: its road, its days, its distance',
  defaults: { ...CARD_DEFAULTS, cardFace: 'trace' },
  contentKeys: ['cardTitle', 'cardSubtitle', 'cardChosen', 'cardFrom', 'cardTo', 'cardFacts'],
  needs: { coverage: true, stages: true, places: true },
  owns: 'layer',
  unmet(ctx) {
    return (ctx.stages ?? []).some((s) => s.places.length > 0) ? null : 'The trip’s legs carry no located place yet.';
  },
  prepare(options, ctx) {
    const { o, plan } = planFor(options, ctx);
    // Never with the badge: its window shut on this slide.
    if (!plan) return { seconds: 0, badgeWindow: { start: 0, end: 0 } };
    const words = ctx.badgeWords;
    const scene = cardScene({
      plan,
      o: { ...o, cardFace: o.cardFace === 'stamp' ? 'trace' : o.cardFace },
      theme: ctx.theme,
      tripName: ctx.tripName,
      words: { ...SUMMARY_WORDS, ...(words?.day ? { day: words.day } : {}), ...(words?.days ? { days: words.days } : {}), ...(words?.stop ? { stop: words.stop } : {}) },
      calendar: ctx.calendar ?? [],
      towns: ctx.towns ?? null,
      vehicle: '',
      below: true,
    });
    const fonts = loadLook(scene.theme);
    const render: HookRender = {
      // Counting up plays; a cut plays nothing, the card is whole at once.
      seconds: o.cardEntrance === 'count' ? CARD_RISE_SECONDS + CARD_COUNT_SECONDS + 0.2 : 0,
      badgeWindow: { start: 0, end: 0 },
      paint: (g, t, frame) => paintCard(g, scene, ctx.pictures, t, frame, t),
      ready: () => fonts,
    };
    return render;
  },
  Sketch: CardSketch,
  Panel: CardPanel,
};
