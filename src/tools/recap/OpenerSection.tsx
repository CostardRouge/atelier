import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withRecap, type RecapDoc, type RecapPicture } from '../../shared/recap/recap-doc';
import { OPENER_HINT, OPENER_LABEL, OPENER_SECONDS, isTripOpener, openerSecondsFor, type OpenerKind, type RecapOpener, type TripOpenerKind } from '../../shared/recap/recap-opener';
import { shownPictures, type OpenerPlan } from '../../shared/recap/recap-opener-plan';
import { isGivenTrip, openerTripFrom, openerTripFromText, ownOpenerTrip, tripFacts, tripMeta, tripSpan, withTripEdit } from '../../shared/recap/recap-opener-trip';
import { storedOptions } from '../../shared/recap/recap-trip-opener';
import type { ResolvedRecap } from '../../shared/recap/recap-slots';
import GarageModal from '../../shared/roadtrip/garage/GarageModal';
import { EASINGS, EASING_IDS, type HookEasing } from '../../shared/roadtrip/hooks/easing';
import type { HookOptions, HookPanelHost, HookPickedPicture, HookStopsChoice } from '../../shared/roadtrip/hooks/hook-variant';
import OpenerPanel from '../../shared/roadtrip/hooks/OpenerPanel';
import { useOpenerChapter } from '../../shared/roadtrip/hooks/opener-chapter-pref';
import { hookVariantById } from '../../shared/roadtrip/hooks/registry';
import { tripPlaces, type MapStop } from '../../shared/roadtrip/hooks/stops';
import StopsMapSheet from '../../shared/roadtrip/hooks/StopsMapSheet';
import type { IsoDate } from '../../shared/roadtrip/trip-days';
import { withCrossBoat, withHopChoice, type HopChoice } from '../../shared/roadtrip/trip-hops';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { mainVehicle, replaceVehicle, withLookOn, type VehicleRef } from '../../shared/roadtrip/vehicle-fleet';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import Button from '../../shared/ui/Button';
import { InspectorSection, SliderRow, TextField, ToggleField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import { PRESS_LOOK } from '../../shared/ui/press';
import { revealInScroller } from '../../shared/ui/reveal';
import OpenerStopsModal from './OpenerStopsModal';
import PictureThumb from './PictureThumb';
import type { Change } from './RecapPanels';
import TripDrawer from './TripDrawer';
import TripThumb from './TripThumb';
import type { TripOpenerState } from './use-trip-opener';
import { useTripCovers } from './use-trip-covers';

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
/**
 * The six openers, as Trips' own grid shows its six (two rows of three):
 * Recap's Défilé and Badge, made for its pictures, then Trips' variants as
 * they are. «None» is the section's switch (lab 16).
 */
const TILES: readonly Exclude<OpenerKind, 'none'>[] = ['defile', 'badge', 'drive', 'map', 'showcase', 'card'];
/** The sketch on each tile: Trips' own drawing of the variant (its Défilé's and its badge's for Recap's two). */
const SKETCH_OF: Record<Exclude<OpenerKind, 'none'>, string> = { defile: 'scrub', badge: 'badge', drive: 'drive', map: 'map', showcase: 'showcase', card: 'card' };
/** How many of the recap's pictures the Badge offers to choose from. */
const BADGE_CHOICES = 24;

interface ChooseRequest {
  selected: readonly HookPickedPicture[];
  resolve: (picked: HookPickedPicture[] | null) => void;
}
interface StopsRequest {
  stops: readonly MapStop[];
  choice: HookStopsChoice;
  resolve: (stops: MapStop[] | null) => void;
}

/**
 * The opener (lab 7, then lab 16): the first seconds of the Reel, before the
 * recap's own first page. Six tiles — Recap's Défilé and Badge, and Trips'
 * Virée, Itinerary, Vitrine and Trip card with THEIR OWN panels, mounted as
 * Trips mounts them (`OpenerPanel`: numbered chapters, one at a time). The
 * trip they drive is a copy the recap keeps, chosen in a mini drawer
 * (`TripDrawer`); with none, the recap's located pictures are the road.
 *
 * This section is the variant panel's HOST (`HookPanelHost`): the garage, a
 * hop's vehicle and the picking map write the recap's copy of the trip and
 * the variant's options — never a document of Trips.
 */
export default function OpenerSection({
  doc,
  resolved,
  change,
  plan,
  trip,
  host,
  client,
  instance,
  files,
  onPlay,
}: {
  doc: RecapDoc;
  resolved: ResolvedRecap;
  change: Change;
  plan: OpenerPlan | null;
  /** Trips' openers over this recap: this device's trips, the chosen variant made ready, each tile's reason. */
  trip: TripOpenerState;
  /** The inspector's block, which the trip drawer rises in. */
  host: HTMLElement | null;
  client: WinnowClient | null;
  instance: string | null;
  files: ReadonlyMap<string, File>;
  onPlay: () => void;
}) {
  const o = doc.opener;
  const set = useCallback((patch: Partial<RecapOpener>) => change((d) => withRecap(d, { opener: { ...d.opener, ...patch } })), [change]);
  const photos = useMemo(() => shownPictures(resolved).filter((p) => p.kind === 'photo').slice(0, BADGE_CHOICES), [resolved]);
  const chosen = plan?.kind === 'badge' ? plan.key : null;
  const on = o.kind !== 'none';
  const onTrip = isTripOpener(o.kind);
  const thumb = (p: RecapPicture) => <PictureThumb pic={p} client={client} instance={instance} file={files.get(p.key) ?? null} className="absolute inset-0 w-full h-full" />;

  // The opener the switch brings back: the last one shown here, Défilé on a recap that never had one.
  const last = useRef<Exclude<OpenerKind, 'none'>>(o.kind === 'none' ? 'defile' : o.kind);
  if (o.kind !== 'none') last.current = o.kind;
  // A refused tile the author touched: its reason is said, nothing is chosen (Trips' rule).
  const [said, setSaid] = useState<TripOpenerKind | null>(null);
  const saidWhy = said ? (trip.unmet[said] ?? null) : null;
  const [drawer, setDrawer] = useState(false);
  const covers = useTripCovers(drawer || onTrip || saidWhy ? trip.trips : null);

  const copy = o.tripCopy;
  const given = isGivenTrip(copy) ? copy : null;
  const { covering, days } = trip;
  /** `kind` chosen, with a copy of the trip covering these days when the recap has none and never refused one. */
  const choose = (kind: Exclude<OpenerKind, 'none'>) => {
    if (isTripOpener(kind)) {
      const take = !copy && o.tripAuto && covering ? covering : null;
      if (!take && trip.unmet[kind]) {
        setSaid(kind);
        return;
      }
      setSaid(null);
      set({ kind, ...(take ? { tripCopy: openerTripFrom(take), tripAuto: false } : {}) });
      return;
    }
    setSaid(null);
    set({ kind, ...(kind !== o.kind ? { seconds: openerSecondsFor(kind) } : {}) });
  };
  /** A trip given: the copy is the recap's, and the tile he was refused is now chosen. */
  const give = (tripCopy: RecapOpener['tripCopy']) => {
    const kind = said ?? (isTripOpener(o.kind) ? o.kind : 'drive');
    setSaid(null);
    set({ kind, tripCopy, tripAuto: false });
  };
  const importFile = (text: string, name: string): string | null => {
    const read = openerTripFromText(text, name);
    if (!read.ok) return read.error;
    give(read.trip);
    return null;
  };

  // ---- the variant's panel and what it may ask of its host ---------------------------
  const setup = trip.setup;
  const live = useRef({ setup, days, title: doc.title });
  live.current = { setup, days, title: doc.title };
  const onPanelChange = useCallback(
    (next: HookOptions) => {
      const s = live.current.setup;
      if (!s) return;
      change((d) => withRecap(d, { opener: { ...d.opener, options: { ...d.opener.options, [s.kind]: storedOptions(s, next) } } }));
    },
    [change],
  );
  /** Write the recap's copy of the trip — made here, of nothing, the first time something is written with no trip given. */
  const writeTrip = useCallback(
    (edit: (t: TripDoc) => TripDoc) =>
      change((d) => withRecap(d, { opener: { ...d.opener, tripCopy: withTripEdit(d.opener.tripCopy ?? ownOpenerTrip(live.current.title, live.current.days), edit) } })),
    [change],
  );
  const [garage, setGarage] = useState(false);
  const [choosing, setChoosing] = useState<ChooseRequest | null>(null);
  const [placing, setPlacing] = useState<StopsRequest | null>(null);
  const hasPlaces = Boolean(setup?.hasTrip);
  const panelHost = useMemo<HookPanelHost>(
    () => ({
      choosePictures: (selected) => new Promise<HookPickedPicture[] | null>((resolve) => setChoosing({ selected, resolve })),
      configureVehicle: () => setGarage(true),
      editStopsOnMap: (stops, choice = {}) => new Promise<MapStop[] | null>((resolve) => setPlacing({ stops, choice, resolve })),
      ...(hasPlaces
        ? {
            chooseHop: (placeId: string, hop: HopChoice) => writeTrip((t) => withHopChoice(t, placeId, hop)),
            chooseCrossBoat: (placeId: string, boat: VehicleRef | null) => writeTrip((t) => withCrossBoat(t, placeId, boat)),
          }
        : {}),
    }),
    [hasPlaces, writeTrip],
  );

  // A chapter opened from far down its index starts at the section's head: the tiles, the trip, then the chapter (lab 16).
  const [openChapter] = useOpenerChapter(setup?.variant.id ?? '');
  const body = useRef<HTMLDivElement>(null);
  const seenChapter = useRef(openChapter);
  useEffect(() => {
    if (seenChapter.current === openChapter) return;
    seenChapter.current = openChapter;
    const section = body.current?.closest('section');
    // On a phone the tabs stick over the page's top: the section starts under them (`--bands-top`, 0 when docked).
    if (section) revealInScroller(section, { block: 'start', margin: parseFloat(getComputedStyle(section).getPropertyValue('--bands-top')) || 0 });
  }, [openChapter]);

  const shownKind: Exclude<OpenerKind, 'none'> | null = saidWhy ? said : on ? (o.kind as Exclude<OpenerKind, 'none'>) : null;
  const tripRow = (saidWhy && said) || onTrip;
  const summary = !on ? 'Off' : onTrip && given ? `${OPENER_LABEL[o.kind]} · ${given.file.name}` : OPENER_LABEL[o.kind];

  return (
    <InspectorSection
      id="recap-opener"
      title="Opener"
      summary={summary}
      actions={<ToggleField checked={on} onChange={(v) => (v ? choose(last.current) : set({ kind: 'none' }))} label="Opener" />}
    >
      <div ref={body} className="flex flex-col gap-2">
        <div className={`grid grid-cols-3 gap-1.5 ${on ? '' : 'opacity-45'}`} role="group" aria-label="Opener">
          {TILES.map((kind) => {
            const active = on && o.kind === kind;
            const unmet = isTripOpener(kind) ? (trip.unmet[kind] ?? null) : null;
            // A tile that would take the covering trip's copy is not refused: choosing it is what brings the trip.
            const refused = unmet && !(isTripOpener(kind) && !copy && o.tripAuto && covering);
            const Sketch = hookVariantById(SKETCH_OF[kind])?.Sketch;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                aria-disabled={refused ? true : undefined}
                title={refused ? unmet : OPENER_HINT[kind]}
                onClick={() => choose(kind)}
                className={`flex flex-col items-stretch gap-1 p-1 pb-1.5 rounded-[10px] border text-center font-sans cursor-pointer select-none transition-[background-color,color,box-shadow,border-color,translate] duration-150 ease-paper ${PRESS_LOOK} focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                  refused
                    ? 'border-line bg-paper-2 text-ink-soft opacity-50 cursor-default'
                    : active
                      ? 'border-accent bg-surface text-ink shadow-[0_0_0_1px_var(--color-accent)]'
                      : 'border-line bg-paper-2 text-ink-soft hover:border-line-strong'
                }`}
              >
                <span className="grid place-items-center w-full aspect-[46/24] rounded-[4px] bg-frame overflow-hidden">{Sketch ? <Sketch /> : null}</span>
                <span className="text-xs font-semibold leading-tight">{OPENER_LABEL[kind]}</span>
              </button>
            );
          })}
        </div>
        {shownKind && (
          <p role="status" className={`m-0 min-h-[1.4em] text-2xs leading-snug ${saidWhy ? 'text-accent-ink' : 'text-muted'}`}>
            <b className={`font-semibold ${saidWhy ? '' : 'text-ink'}`}>{OPENER_LABEL[shownKind]}</b>
            {' · '}
            {saidWhy ?? OPENER_HINT[shownKind]}
          </p>
        )}
        {tripRow && (
          <button
            type="button"
            onClick={() => {
              trip.reload();
              setDrawer(true);
            }}
            title={given ? 'A copy kept with this recap. Changing it here never changes the trip in Trips.' : 'Without a trip, the located pictures of the recap draw the road.'}
            className={`w-full grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-2.5 p-1.5 pointer-coarse:min-h-11 rounded-control border border-line bg-paper-2 text-left font-sans cursor-pointer select-none hover:border-line-strong ${PRESS_LOOK} focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent`}
          >
            <TripThumb trip={given ? given.file : null} cover={given?.from.kind === 'trips' ? (covers.get(given.from.id) ?? null) : null} />
            <span className="min-w-0 flex flex-col">
              <span className="text-xs font-semibold text-ink truncate">{given ? given.file.name || 'Untitled trip' : 'No trip'}</span>
              <span className="font-mono text-3xs text-muted truncate">{given ? `${tripSpan(given.file.startDate, given.file.endDate)} · ${tripMeta(tripFacts(given.file))}` : 'the pictures’ own GPS'}</span>
            </span>
            <span className="px-1 text-xs font-medium text-accent-ink">{given ? 'Change' : 'Choose…'}</span>
          </button>
        )}
        {o.kind === 'defile' && !plan && <p className="m-0 text-xs text-muted">It needs two pictures on the recap at least.</p>}
        {(o.kind === 'defile' || o.kind === 'badge') && (
          <SliderRow
            label={o.kind === 'badge' ? 'Holds' : 'Runs'}
            value={o.seconds}
            min={OPENER_SECONDS.min}
            max={OPENER_SECONDS.max}
            step={0.1}
            reset={openerSecondsFor(o.kind)}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(seconds) => set({ seconds })}
          />
        )}
        {o.kind === 'defile' && (
          <>
            <span className={legend}>How it slows</span>
            <Segmented<HookEasing> size="sm" columns={3} label="How the pictures slow" value={o.easing} onChange={(easing) => set({ easing })} options={EASING_IDS.map((k) => ({ id: k, label: EASINGS[k].label, title: EASINGS[k].hint }))} />
            <ToggleField checked={o.tape} onChange={(tape) => set({ tape })} label="The tape of the days">
              The tape of the days
            </ToggleField>
            <ToggleField checked={o.ticks} onChange={(ticks) => set({ ticks })} label="A tick at every picture">
              A tick at every picture
            </ToggleField>
          </>
        )}
        {o.kind === 'badge' && (
          <>
            <span className={legend}>The picture</span>
            <div className="max-h-44 overflow-y-auto [scrollbar-width:thin]">
              <div className="grid grid-cols-6 gap-1 p-0.5" role="listbox" aria-label="The Badge's picture">
                <button
                  type="button"
                  role="option"
                  aria-selected={o.picture === null}
                  onClick={() => set({ picture: null })}
                  title="The recap's best picture: picked, then starred"
                  className={`relative aspect-square rounded-[4px] border font-mono text-3xs uppercase ${o.picture === null ? 'border-accent text-accent-ink bg-accent/10' : 'border-line text-muted bg-transparent'}`}
                >
                  Best
                </button>
                {photos.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="option"
                    aria-selected={chosen === p.key}
                    onClick={() => set({ picture: p.key })}
                    title={p.name}
                    className={`relative aspect-square overflow-hidden rounded-[4px] p-0 border-0 ${chosen === p.key ? 'outline outline-2 outline-accent' : 'outline outline-1 outline-line'}`}
                  >
                    {thumb(p)}
                  </button>
                ))}
              </div>
            </div>
            <span className={legend}>It says</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <ToggleField checked={o.lines.date} onChange={(date) => set({ lines: { ...o.lines, date } })} label="Its day">
                Its day
              </ToggleField>
              <ToggleField checked={o.lines.place} onChange={(place) => set({ lines: { ...o.lines, place } })} label="Its place">
                Its place
              </ToggleField>
              <ToggleField checked={o.lines.camera} onChange={(camera) => set({ lines: { ...o.lines, camera } })} label="Its camera">
                Its camera
              </ToggleField>
            </div>
            <TextField
              value={o.title ?? ''}
              onChange={(v) => set({ title: v.trim() ? v.slice(0, 120) : null })}
              label="The Badge's big line"
              placeholder={plan?.kind === 'badge' && plan.title ? plan.title : 'Its place, else the title'}
            />
          </>
        )}
        {onTrip && setup && !saidWhy && <OpenerPanel variant={setup.variant} options={setup.options} ctx={setup.ctx} host={panelHost} onChange={onPanelChange} />}
        {on && (
          <Button size="sm" variant="ghost" icon={Icons.play} onClick={onPlay} title="Play the film from its first second">
            Play the opener
          </Button>
        )}
        {(o.kind === 'badge' || onTrip) && (
          <ToggleField checked={o.slide} onChange={(slide) => set({ slide })} label="Also the carousel's first slide">
            Also the carousel's first slide
          </ToggleField>
        )}
      </div>

      {drawer && (
        <TripDrawer
          host={host}
          trips={trip.trips ?? []}
          covers={covers}
          days={days}
          current={copy}
          onPick={(t) => give(openerTripFrom(t))}
          onImport={importFile}
          onNone={() => set({ tripCopy: null, tripAuto: false })}
          onClose={() => setDrawer(false)}
        />
      )}
      {garage && setup && (
        <GarageModal
          trip={setup.trip}
          day={setup.day as IsoDate}
          onCancel={() => setGarage(false)}
          onDone={(spec) => {
            const day = setup.day as IsoDate;
            writeTrip((t) => ({ ...t, vehicles: replaceVehicle(t.vehicles, withLookOn(mainVehicle(t.vehicles), day, spec)) }));
            setGarage(false);
          }}
        />
      )}
      {choosing && setup && (
        <OpenerStopsModal
          located={setup.located}
          selected={choosing.selected}
          auto={setup.auto.picked}
          pictures={doc.pictures}
          client={client}
          instance={instance}
          files={files}
          onCancel={() => {
            choosing.resolve(null);
            setChoosing(null);
          }}
          onDone={(picked) => {
            choosing.resolve(picked);
            setChoosing(null);
          }}
        />
      )}
      {placing && setup && (
        <StopsMapSheet
          stops={placing.stops}
          places={tripPlaces(setup.ctx.stages)}
          title={placing.choice.title}
          grouping={placing.choice.grouping}
          onCancel={() => {
            placing.resolve(null);
            setPlacing(null);
          }}
          onDone={(stops) => {
            placing.resolve(stops);
            setPlacing(null);
          }}
        />
      )}
    </InspectorSection>
  );
}
