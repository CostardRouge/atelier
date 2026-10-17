import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import { allowTiles, tilesAllowed } from '../../shared/map/osm-tiles';
import { useSurface } from '../../shared/ui/use-surface';
import IconButton from '../../shared/ui/IconButton';
import PageBar from '../../shared/ui/PageBar';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { Icons } from '../../shared/ui/icons';
import AtlasInspector from './AtlasInspector';
import AtlasStage from './AtlasStage';
import AtlasTransport from './AtlasTransport';
import { AtlasTiles } from './atlas-tiles';
import { visibleBox, type AtlasView } from './atlas-view';
import type { WorldBox } from './atlas-flight';
import { PlayClock } from './play-clock';
import { useAtlasExport, type ExportKind } from './use-atlas-export';
import { useAtlasDocFlights } from './use-atlas-doc-flights';
import { useAtlasLogos } from './atlas-logos';
import { useAtlasScene } from './use-atlas-scene';
import { DEFAULT_SETTINGS, sanitizeSettings, type AtlasSettings } from './atlas-settings';
import { cleanAtlasName, withFlights, withoutFlights, type AtlasDoc } from './atlas-doc';
import { ingestLogs, type IngestItem } from './atlas-ingest';
import { useAtlasCover } from './use-atlas-cover';
import { parseLayer, type AtlasLayer } from './atlas-layers';
import { withPlacement, type PieceId, type Placement } from './atlas-place';

const LAYER_KEY = 'atelier.atlas.layer';

function readLayer(): AtlasLayer {
  try {
    return parseLayer(localStorage.getItem(LAYER_KEY));
  } catch {
    return 'map';
  }
}

/** What the atlas takes from the Library: anything carrying a DJI telemetry log. */
export const ATLAS_KINDS = ['video+telemetry', 'telemetry'] as const;

/** Where the editor's save stands, as its bar says it. */
export type SaveState = 'saved' | 'saving' | 'failed';

interface AtlasEditorProps {
  doc: AtlasDoc;
  /** Every edit, through one funnel — the shell saves it. */
  change: (fn: (doc: AtlasDoc) => AtlasDoc) => void;
  saveState: SaveState;
  onBack: () => void;
  /** Drawn under the bar: another tab edits this atlas. */
  band?: ReactNode;
}

const SAVE_WORDS: Record<SaveState, string> = { saved: 'Saved', saving: 'Saving…', failed: 'Not saved' };

/**
 * Flight Atlas — EXPERIMENTAL. One ATLAS (`atlas-doc.ts`): its flights drawn
 * together on one map and animated, the way the Perth bus map draws a city's
 * day — a faint network of every route, comets for what is in the air, a
 * clock and a count in the corner. Only the GPS track of each `.srt` is
 * read; the videos are never opened, and each log's text is kept on this
 * device with the atlas (`atlas-store.ts`), so it reopens from the gallery
 * with nothing else at hand.
 *
 * Every dial and every flight is the document's, written through `change`;
 * what leaves is an MP4 or a PNG painted by the preview's own painter.
 */
export default function AtlasEditor({ doc, change, saveState, onBack, band }: AtlasEditorProps) {
  useSurface('darkroom');
  const compact = useIsCompact();
  const lib = useAssetLibrary();
  const settings = doc.settings;
  const update = useCallback(
    (fn: (s: AtlasSettings) => AtlasSettings) => change((d) => ({ ...d, settings: sanitizeSettings(fn(d.settings)), updatedAt: Date.now() })),
    [change],
  );
  const reset = useCallback(() => change((d) => ({ ...d, settings: DEFAULT_SETTINGS, updatedAt: Date.now() })), [change]);
  const hidden = useMemo(() => new Set(doc.hidden), [doc.hidden]);
  const setHidden = useCallback((next: Set<string>) => change((d) => ({ ...d, hidden: [...next], updatedAt: Date.now() })), [change]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [freeView, setFreeView] = useState<AtlasView | null>(null);
  // The tiles switch is OFF every time the atlas opens (`local-first.md`).
  const [tilesOn, setTilesOnState] = useState(false);
  const [paintSeq, setPaintSeq] = useState(0);

  // The Library's ticked logs are OFFERED to the atlas, never drawn by themselves.
  const librarySources = useMemo<IngestItem[]>(
    () =>
      selectedUsableAssets(ATLAS_KINDS, lib.assets, lib.selection).flatMap((a) =>
        a.parts.srt ? [{ file: a.parts.srt, name: a.baseName, video: a.parts.video ?? null, was: a.id }] : [],
      ),
    [lib.assets, lib.selection],
  );
  const { flights, reading, empty, aircraft, missing, reload } = useAtlasDocFlights(doc.flights);
  const winnowHeld = useMemo(() => new Set(doc.flights.flatMap((f) => (f.winnow ? [f.winnow] : []))), [doc.flights]);

  // Adding logs: read, hashed, kept on this device, then referenced by the atlas.
  const [adding, setAdding] = useState<string | null>(null);
  const addItems = useCallback(
    async (items: readonly IngestItem[]) => {
      if (!items.length) return;
      setAdding(`Reading ${items.length} log${items.length === 1 ? '' : 's'}…`);
      const before = new Set(doc.flights.map((f) => f.id));
      const got = await ingestLogs(items, (done, total) => setAdding(`Reading logs… ${done}/${total}`));
      const fresh = got.refs.filter((r) => !before.has(r.id)).length;
      change((d) => withFlights(d, got.refs));
      const parts = [
        fresh ? `${fresh} flight${fresh === 1 ? '' : 's'} added` : 'No new flight',
        got.refs.length > fresh ? `${got.refs.length - fresh} already here` : '',
        got.failed.length ? `${got.failed.length} unreadable (${got.failed.slice(0, 3).join(', ')}${got.failed.length > 3 ? '…' : ''})` : '',
        got.kept ? '' : 'this browser refused to keep their text — they last this visit only',
      ].filter(Boolean);
      setAdding(`${parts.join(' · ')}.`);
    },
    [doc.flights, change],
  );
  const onAddFiles = useCallback((files: File[]) => void addItems(files.map((file) => ({ file }))), [addItems]);
  const onAddLibrary = useCallback(() => void addItems(librarySources), [addItems, librarySources]);
  const onFindMissing = useCallback(
    async (files: File[]) => {
      // Only a text matching a missing hash is kept: a folder is never added wholesale here.
      const wanted = new Set(missing.map((m) => m.log));
      setAdding(`Looking through ${files.length} log${files.length === 1 ? '' : 's'}…`);
      const got = await ingestLogs(files.map((file) => ({ file })));
      const found = got.refs.filter((r) => wanted.has(r.log)).length;
      setAdding(found ? `${found} of ${wanted.size} log${wanted.size === 1 ? '' : 's'} found.` : `None of the ${wanted.size} missing log${wanted.size === 1 ? '' : 's'} is in that folder.`);
      reload();
    },
    [missing, reload],
  );
  const onRemoveHidden = useCallback(() => change((d) => withoutFlights(d, d.hidden)), [change]);
  const logos = useAtlasLogos();
  const scene = useAtlasScene(flights, hidden, settings, freeView, aircraft, logos);

  const clock = useRef(new PlayClock()).current;
  const storyRef = useRef(scene.core.story);
  storyRef.current = scene.core.story;
  // The inspector's layer: one of its chips, or whatever was clicked on the stage.
  // An atlas with no flight yet opens where flights are added.
  const [layer, setLayerState] = useState<AtlasLayer>(() => (doc.flights.length ? readLayer() : 'data'));
  const setLayer = useCallback((next: AtlasLayer) => {
    // Opening the intro or the outro plays it, unless the playhead is already in it.
    const st = storyRef.current;
    if (next === 'intro' && st.intro > 0 && clock.t >= st.intro) {
      clock.seek(0);
      clock.setPlaying(true);
    } else if (next === 'outro' && st.outro > 0 && clock.t < st.intro + st.flights) {
      clock.seek(st.intro + st.flights);
      clock.setPlaying(true);
    }
    setLayerState(next);
    try {
      localStorage.setItem(LAYER_KEY, next);
    } catch {
      /* the layer holds for the session */
    }
  }, [clock]);
  useEffect(() => clock.setTotal(scene.core.story.total), [clock, scene.core.story.total]);
  // Start playing the first time there is something to play.
  const started = useRef(false);
  useEffect(() => {
    if (!started.current && scene.core.flights.length > 0 && !reading) {
      started.current = true;
      clock.setPlaying(true);
    }
  }, [clock, scene.core.flights.length, reading]);

  const tiles = useMemo(() => (tilesOn ? new AtlasTiles(() => setPaintSeq((n) => n + 1)) : null), [tilesOn]);
  useEffect(() => () => tiles?.dispose(), [tiles]);
  useEffect(() => tiles?.setTone(settings.map.tileTone), [tiles, settings.map.tileTone]);
  useEffect(() => setPaintSeq((n) => n + 1), [settings.map.tileTone]);

  const setTilesOn = useCallback((on: boolean) => {
    if (on && !tilesAllowed()) allowTiles(true);
    setTilesOnState(on);
  }, []);

  const stickerNames = useMemo(() => [...new Set(scene.core.aircraft.filter((n): n is string => !!n))], [scene.core.aircraft]);
  const streetsSwitch = useMemo(() => ({ on: tilesOn, set: setTilesOn }), [tilesOn, setTilesOn]);

  const onFreeView = useCallback(
    (view: AtlasView) => {
      setFreeView(view);
      if (settings.camera.frame !== 'free') update((s) => ({ ...s, camera: { ...s.camera, frame: 'free' } }));
    },
    [settings.camera.frame, update],
  );
  const onFit = useCallback(() => {
    setFreeView(null);
    update((s) => ({ ...s, camera: { ...s.camera, frame: 'all' } }));
  }, [update]);

  const focus = useMemo(() => {
    if (!focusId) return null;
    const i = scene.core.flights.findIndex((f) => f.id === focusId);
    return i >= 0 ? i : null;
  }, [focusId, scene.core.flights]);

  const exporter = useAtlasExport(settings);
  const onExport = useCallback(
    (kind: ExportKind) => {
      clock.setPlaying(false);
      void exporter.run({ kind, at: clock.t }, scene.core, scene.viewAt, tilesOn);
    },
    [clock, exporter, scene.core, scene.viewAt, tilesOn],
  );

  // A zone is drawn on the map, or taken from the view on screen.
  const [drawingZone, setDrawingZone] = useState(false);
  const onZone = useCallback(
    (zone: WorldBox) => {
      setDrawingZone(false);
      update((s) => ({ ...s, camera: { ...s.camera, frame: 'zone', zone } }));
    },
    [update],
  );
  const onZoneFromView = useCallback(() => {
    const look = { bearing: settings.camera.bearing, tilt: settings.camera.tilt };
    onZone(visibleBox(scene.viewAt(clock.t), look, scene.mapFrame.w, scene.mapFrame.h));
  }, [onZone, scene, clock, settings.camera.bearing, settings.camera.tilt]);

  const onPlace = useCallback((piece: PieceId, place: Placement) => update((s) => withPlacement(s, piece, place)), [update]);

  const look = useMemo(() => ({ bearing: settings.camera.bearing, tilt: settings.camera.tilt }), [settings.camera.bearing, settings.camera.tilt]);

  const empties = flights.length === 0 && !reading;
  useAtlasCover(doc, scene.core, scene.viewAt, !reading && missing.length === 0);
  const [name, setName] = useState(doc.name);
  useEffect(() => setName(doc.name), [doc.name]);
  const commitName = () => {
    const clean = cleanAtlasName(name);
    if (clean && clean !== doc.name) change((d) => ({ ...d, name: clean, updatedAt: Date.now() }));
    else setName(doc.name);
  };

  return (
    <section className="@container flex-1 min-h-0 flex flex-col gap-3" aria-label="Flight Atlas">
      <PageBar
        back={{ label: 'Atlases', onClick: onBack, iconOnly: compact }}
        trailing={
          <span
            className={`font-mono text-2xs ${saveState === 'failed' ? 'text-danger' : 'text-muted'}`}
            role="status"
            title={saveState === 'failed' ? 'The browser refused to store this atlas (a private window, or the disk is full) — your edits are still on screen.' : 'Every change is kept on this device as you go.'}
          >
            {SAVE_WORDS[saveState]}
          </span>
        }
      >
        <input
          aria-label="Atlas name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setName(doc.name);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={`min-w-0 flex-1 h-9 px-2 rounded-control border border-transparent bg-transparent font-serif text-ink hover:border-line focus:border-line-strong focus:bg-paper focus:outline-none ${compact ? 'text-lg' : 'text-2xl'}`}
        />
      </PageBar>
      {band}
      <div className="flex-1 min-h-0 flex flex-col gap-3 @min-[860px]:grid @min-[860px]:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-2 min-h-0 min-w-0 flex-[1.4] @min-[860px]:flex-none">
          <div className="flex-none flex flex-wrap items-center gap-2 px-2 py-1.5 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
            <span className="font-mono text-3xs uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border border-warn-line bg-warn-wash text-warn">
              Experimental
            </span>
            <span className="font-mono text-2xs text-muted tabular-nums">
              {reading
                ? `reading ${reading.done}/${reading.total}…`
                : `${scene.core.flights.length} flight${scene.core.flights.length === 1 ? '' : 's'} · ${scene.places.length} place${scene.places.length === 1 ? '' : 's'}`}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <IconButton size="sm" variant="ghost" label="Fit every flight" onClick={onFit}>
                {Icons.map}
              </IconButton>
            </span>
          </div>
          <div className="relative flex-1 min-h-[220px] flex rounded-paper-lg bg-frame border border-line p-2">
            <AtlasStage
              core={scene.core}
              viewAt={scene.viewAt}
              clock={clock}
              tiles={tiles}
              focus={focus}
              format={settings.format}
              theme={settings.hud.theme}
              look={look}
              onFreeView={onFreeView}
              drawingZone={drawingZone}
              onZone={onZone}
              paintSeq={paintSeq}
              selected={layer}
              onPick={setLayer}
              onPlace={onPlace}
            />
            {empties && (
              <div className="absolute inset-0 grid place-items-center p-6 pointer-events-none">
                <p className="m-0 max-w-sm text-center text-sm text-on-media bg-black/55 px-4 py-3 rounded-paper">
                  {missing.length > 0
                    ? 'This atlas’s logs are not on this device — bring them back from the Flights panel.'
                    : <>Add DJI logs (<code className="font-mono">.srt</code>) from the Flights panel — files, a folder, the clips ticked in the
                      Library, or your Winnow&rsquo;s logs alone: every flight&rsquo;s GPS track is drawn here, never its video.</>}
                </p>
              </div>
            )}
          </div>
          <AtlasTransport clock={clock} activity={scene.core.activity} story={scene.core.story} streets={streetsSwitch} />
        </div>
        <aside className="flex-1 min-h-0 flex flex-col overflow-hidden border border-line rounded-paper-lg bg-surface shadow-paper-soft @min-[860px]:flex-none" aria-label="Flight Atlas settings">
          <AtlasInspector
            layer={layer}
            onLayer={setLayer}
            settings={settings}
            update={update}
            onReset={() => {
              reset();
              setFreeView(null);
            }}
            flights={flights}
            hidden={hidden}
            setHidden={setHidden}
            places={scene.places}
            placeNames={scene.placeNames}
            onFocus={setFocusId}
            reading={reading}
            empty={empty}
            onAddFiles={onAddFiles}
            librarySelected={librarySources.length}
            onAddLibrary={onAddLibrary}
            missing={missing.length}
            onFindMissing={(files) => void onFindMissing(files)}
            onRemoveHidden={onRemoveHidden}
            winnowHeld={winnowHeld}
            adding={adding}
            tilesOn={tilesOn}
            setTilesOn={setTilesOn}
            onFit={onFit}
            drawingZone={drawingZone}
            setDrawingZone={setDrawingZone}
            onZoneFromView={onZoneFromView}
            aircraftFound={scene.aircraftFound}
            unnamed={scene.unnamed}
            stickerNames={stickerNames}
            dateRange={scene.core.dateRange}
            total={scene.core.story.total}
            exporter={exporter}
            onExport={onExport}
          />
        </aside>
      </div>
    </section>
  );
}
