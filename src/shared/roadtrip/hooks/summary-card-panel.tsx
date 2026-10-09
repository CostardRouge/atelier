/**
 * The summary card's rows in Virée's panel (`summary-card.ts`): which face,
 * which look, what ground, what it says, which places it names, how it comes
 * — and when the BADGE is on screen, since the two never are together.
 *
 * Every row says what the card will really draw for this piece: a fact the
 * drive cannot measure is offered and said missing, a ground with no picture
 * on the road says it falls back to the look's solid.
 */

import Segmented from '../../ui/Segmented';
import { PRESS_LOOK } from '../../ui/press';
import { FieldRow, RangeField, SelectField, TextField } from '../../ui/Inspector';
import { FacePicker, LookPicker } from './card-thumbs';
import type { DriveOptions, DrivePlan } from './drive-plan';
import {
  CARD_FACES,
  CARD_FACTS,
  CARD_FACT_NAMES,
  CARD_LIMITS,
  DEFAULT_SUBTITLE,
  MAX_CARD_FACTS,
  badgeMoment,
  cardCells,
  cardFacts,
  cityCode,
  placeName,
  type BadgeWhen,
  type CardFact,
  type CardOptions,
} from './summary-card';
import type { HookContext } from './hook-variant';

interface Props {
  o: DriveOptions;
  set: (patch: Partial<CardOptions>) => void;
  plan: DrivePlan | null;
  ctx: HookContext;
  /** Offer when the badge shows — Virée's; a card on its slide alone hides it. */
  badge?: boolean;
}

const WORDS = { day: 'Day', days: 'days', stop: 'Stop', stops: 'stops' };

/** One line per face: what it draws. */
const FACE_HINTS: Record<CardOptions['cardFace'], string> = {
  trace: 'The trip’s road drawn big, its places named.',
  ticket: 'A boarding pass; its barcode is the trip’s days.',
  passport: 'A stamp for each state the road crossed.',
  sheet: 'The road’s pictures as a contact sheet, the road beside them.',
  stamp: 'The facts in the map’s box, the map still under it.',
  dash: 'The odometer and a gauge of the trip’s days.',
};

export function SummaryCardRows({ o, set, plan, ctx, badge = true }: Props) {
  const face = o.cardFace;
  const stamp = face === 'stamp';
  const facts = plan ? cardFacts(plan) : null;
  const measurable = new Set(facts ? cardCells(facts, CARD_FACTS, WORDS, o.distance).map((c) => c.fact) : []);
  const pictures = plan ? plan.route.stops.some((s) => s.pictures.length > 0) : false;
  const names = plan ? [...new Set(plan.route.stops.map(placeName).filter(Boolean))] : [];
  const moment = badgeMoment(o.badgeWhen);
  const roadNames = face === 'trace';

  const toggleFact = (fact: CardFact) => {
    const on = o.cardFacts.includes(fact);
    if (on) set({ cardFacts: o.cardFacts.filter((f) => f !== fact) });
    else if (o.cardFacts.length < MAX_CARD_FACTS) set({ cardFacts: [...o.cardFacts, fact] });
  };

  return (
    <>
      <FacePicker
        faces={CARD_FACES.filter((id) => badge || id !== 'stamp')}
        value={face}
        onChange={(cardFace) => set({ cardFace })}
        plan={plan}
        pictures={ctx.pictures}
        aspect={ctx.aspect}
        input={{
          o,
          theme: ctx.theme,
          tripName: ctx.tripName,
          words: WORDS,
          calendar: ctx.calendar ?? [],
          towns: ctx.towns ?? null,
          vehicle: '',
          below: !badge,
          writing: ctx.writing,
        }}
      />
      <p className="m-0 -mt-1 text-xs text-muted">{FACE_HINTS[face]}</p>
      <LookPicker value={o.cardLook} onChange={(cardLook) => set({ cardLook })} trip={ctx.theme} />
      {!stamp && (
        <FieldRow
          label="Ground"
          hint={
            o.cardGround === 'photo' && !pictures
              ? 'No picture on the road: the card stands on the look’s own solid.'
              : badge
                ? 'The trip’s last picture veiled, the look’s own solid, or the map’s paper — where the words take the map’s ink.'
                : 'The slide’s own picture veiled, the look’s own solid, or the map’s paper — where the words take the map’s ink.'
          }
          hintShown={o.cardGround === 'photo' && !pictures && badge}
        >
          <Segmented
            size="sm"
            fill
            label="What is under the card"
            value={o.cardGround}
            onChange={(cardGround) => set({ cardGround })}
            options={[
              { id: 'photo', label: 'Photo' },
              { id: 'solid', label: 'Solid' },
              { id: 'paper', label: 'Paper' },
            ]}
          />
        </FieldRow>
      )}
      {!stamp && (
        <>
          <FieldRow label="Title">
            <TextField label="The card’s title" value={o.cardTitle} placeholder={ctx.tripName || 'The trip’s name'} onChange={(cardTitle) => set({ cardTitle })} />
          </FieldRow>
          <FieldRow label="Subtitle">
            <TextField label="The card’s subtitle" value={o.cardSubtitle} placeholder={DEFAULT_SUBTITLE} onChange={(cardSubtitle) => set({ cardSubtitle })} />
          </FieldRow>
        </>
      )}
      <FieldRow label="Says" align="start" hint={`Up to ${MAX_CARD_FACTS}, in the order you pick them. A fact the drive cannot measure is left out.`}>
        <div className="flex flex-wrap gap-1" role="group" aria-label="What the card says">
          {CARD_FACTS.map((fact) => {
            const at = o.cardFacts.indexOf(fact);
            const on = at >= 0;
            const missing = !measurable.has(fact);
            return (
              <button
                key={fact}
                type="button"
                aria-pressed={on}
                aria-disabled={!on && o.cardFacts.length >= MAX_CARD_FACTS}
                title={missing ? 'Nothing measures it on this drive' : undefined}
                onClick={() => toggleFact(fact)}
                className={`inline-flex items-center gap-1 h-7 px-2 rounded-[8px] border text-xs cursor-pointer select-none ${PRESS_LOOK} focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                  on ? 'bg-surface text-ink font-semibold border-line-strong' : 'bg-paper-2 text-ink-soft border-line'
                } ${missing ? 'opacity-55' : ''}`}
              >
                {on && <span className="font-mono text-2xs text-muted">{at + 1}</span>}
                {CARD_FACT_NAMES[fact]}
              </button>
            );
          })}
        </div>
      </FieldRow>
      {roadNames && (
        <FieldRow
          label="Places"
          hint="Names that would cover another are left out, the ends first."
        >
          <Segmented
            size="sm"
            columns={3}
            label="Which places the card names"
            value={o.cardLabels}
            onChange={(cardLabels) => set({ cardLabels })}
            options={[
              { id: 'none', label: 'None' },
              { id: 'ends', label: 'Ends' },
              { id: 'groups', label: 'Grouped' },
              { id: 'all', label: 'Every place' },
              { id: 'chosen', label: 'Mine' },
            ]}
          />
        </FieldRow>
      )}
      {roadNames && o.cardLabels === 'groups' && (
        <>
          <FieldRow label="Within">
            <RangeField
              label="Places this close are one name"
              min={CARD_LIMITS.cardLabelKm.min}
              max={CARD_LIMITS.cardLabelKm.max}
              step={10}
              value={o.cardLabelKm}
              onChange={(cardLabelKm) => set({ cardLabelKm })}
              format={(v) => `${Math.round(v)} km`}
            />
          </FieldRow>
          <FieldRow label="Named" hint={o.cardLabelName === 'town' && !ctx.towns ? 'The town index is still loading: the first place names a group meanwhile.' : undefined}>
            <SelectField
              label="What names a group of places"
              value={o.cardLabelName}
              onChange={(cardLabelName) => set({ cardLabelName })}
              options={[
                { id: 'town', label: 'The biggest town' },
                { id: 'stay', label: 'The longest stay' },
                { id: 'first', label: 'The first place' },
              ]}
            />
          </FieldRow>
        </>
      )}
      {roadNames && o.cardLabels === 'chosen' && (
        <FieldRow label="Named" align="start">
          <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto" role="group" aria-label="The places the card names">
            {names.map((name) => {
              const on = o.cardChosen.some((c) => c.toLowerCase() === name.toLowerCase());
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set({ cardChosen: on ? o.cardChosen.filter((c) => c.toLowerCase() !== name.toLowerCase()) : [...o.cardChosen, name] })
                  }
                  className={`h-7 px-2 rounded-[8px] border text-xs cursor-pointer select-none ${PRESS_LOOK} ${
                    on ? 'bg-surface text-ink font-semibold border-line-strong' : 'bg-paper-2 text-ink-soft border-line'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </FieldRow>
      )}
      {face === 'passport' && (
        <>
          <FieldRow
            label="Stamps"
            hint={
              o.cardStampMode === 'mixed'
                ? 'In the road’s order: the state where it is known, else the place. A round stamp is a state, a rectangle a place.'
                : o.cardStampMode === 'states'
                  ? 'The states alone; a place with none gets no stamp. With no state at all, the places come back.'
                  : 'One stamp per place, its three letters.'
            }
          >
            <Segmented
              size="sm"
              fill
              label="What the stamps tell"
              value={o.cardStampMode}
              onChange={(cardStampMode) => set({ cardStampMode })}
              options={[
                { id: 'mixed', label: 'Combined' },
                { id: 'states', label: 'States' },
                { id: 'places', label: 'Places' },
              ]}
            />
          </FieldRow>
          {o.cardStampMode !== 'places' && (
            <>
              <FieldRow
                label="Missing state"
                hint={
                  o.cardStampFill === 'index'
                    ? `Read from the town index the app ships, when it says so without doubt — never written into your places.${ctx.towns ? '' : ' The index is still loading.'}`
                    : 'A place that does not say its state stays without one.'
                }
              >
                <Segmented
                  size="sm"
                  fill
                  label="A place’s missing state"
                  value={o.cardStampFill}
                  onChange={(cardStampFill) => set({ cardStampFill })}
                  options={[
                    { id: 'index', label: 'From the town index' },
                    { id: 'none', label: 'Left missing' },
                  ]}
                />
              </FieldRow>
              <FieldRow label="A state">
                <Segmented
                  size="sm"
                  fill
                  label="How a state is written"
                  value={o.cardStampState}
                  onChange={(cardStampState) => set({ cardStampState })}
                  options={[
                    { id: 'code', label: 'Code' },
                    { id: 'full', label: 'Full name' },
                  ]}
                />
              </FieldRow>
            </>
          )}
          <FieldRow label={o.cardStampMode === 'places' ? 'A place' : 'No state'}>
            <Segmented
              size="sm"
              fill
              label="How a place with no state is stamped"
              value={o.cardStampPlace}
              onChange={(cardStampPlace) => set({ cardStampPlace })}
              options={[
                { id: 'code', label: '3 letters' },
                { id: 'full', label: 'Full name' },
                ...(o.cardStampMode === 'mixed' ? [{ id: 'skip' as const, label: 'No stamp' }] : []),
              ]}
            />
          </FieldRow>
          <FieldRow label="Stamped" hint={o.cardStampOnce === 'visit' ? 'A state left and found again is stamped again, like a real passport.' : undefined}>
            <Segmented
              size="sm"
              fill
              label="How often a destination is stamped"
              value={o.cardStampOnce}
              onChange={(cardStampOnce) => set({ cardStampOnce })}
              options={[
                { id: 'once', label: 'Once' },
                { id: 'visit', label: 'At each visit' },
              ]}
            />
          </FieldRow>
        </>
      )}
      {face === 'ticket' && facts && (
        <FieldRow label="Codes">
          <div className="flex gap-2 w-full">
            <TextField label="The departure’s three letters" value={o.cardFrom} placeholder={cityCode(facts.first)} onChange={(cardFrom) => set({ cardFrom: cardFrom.toUpperCase().slice(0, 3) })} />
            <TextField label="The arrival’s three letters" value={o.cardTo} placeholder={cityCode(facts.last)} onChange={(cardTo) => set({ cardTo: cardTo.toUpperCase().slice(0, 3) })} />
          </div>
        </FieldRow>
      )}
      <FieldRow label="Entrance">
        <Segmented
          size="sm"
          fill
          label="How the card comes"
          value={o.cardEntrance}
          onChange={(cardEntrance) => set({ cardEntrance })}
          options={[
            { id: 'count', label: 'Count up' },
            { id: 'cut', label: 'Cut' },
          ]}
        />
      </FieldRow>
      {badge && <FieldRow
        label="Badge"
        hint={
          moment === 'before'
            ? 'The badge opens the piece while the car waits, and leaves as it starts.'
            : moment === 'during'
              ? 'The badge counts with the car and leaves as the card comes.'
              : moment === 'end'
                ? 'No card: the badge comes at the end in its place, as the map fades.'
                : 'No badge on this piece: the drive, then the card.'
        }
      >
        <Segmented<Exclude<BadgeWhen, 'auto'>>
          size="sm"
          columns={2}
          label="When the badge is on screen — never with the card"
          value={moment}
          onChange={(badgeWhen) => set({ badgeWhen })}
          options={[
            { id: 'before', label: 'Before the drive' },
            { id: 'during', label: 'During the drive' },
            { id: 'end', label: 'At the end' },
            { id: 'never', label: 'Never' },
          ]}
        />
      </FieldRow>}
    </>
  );
}
