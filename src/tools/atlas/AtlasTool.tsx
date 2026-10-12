import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import { allowTiles, tilesAllowed } from '../../shared/map/osm-tiles';
import { useSurface } from '../../shared/ui/use-surface';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import AtlasInspector from './AtlasInspector';
import AtlasStage from './AtlasStage';
import AtlasTransport from './AtlasTransport';
import { AtlasTiles } from './atlas-tiles';
import { visibleBox, type AtlasView } from './atlas-view';
import type { WorldBox } from './atlas-flight';
import { PlayClock } from './play-clock';
import { useAtlasExport, type ExportKind } from './use-atlas-export';
import { useAtlasFlights, type FlightSource } from './use-atlas-flights';
import { useAtlasScene } from './use-atlas-scene';
import { useAtlasSettings } from './use-atlas-settings';

/** What the atlas reads: anything carrying a DJI telemetry log. */
const ATLAS_KINDS = ['video+telemetry', 'telemetry'] as const;

/**
 * Flight Atlas — EXPERIMENTAL. Every drone flight the Library holds, drawn
 * together on one map and animated, the way the Perth bus map draws a city's
 * day: a faint network of every route, comets for what is in the air, a
 * clock and a count in the corner. Only the GPS track of each `.srt` is
 * read; the videos are never opened.
 *
 * Nothing is a document: the flights are the Library's selection, the dials
 * are a per-browser convenience (`use-atlas-settings.ts`), and what leaves is
 * an MP4 or a PNG painted by the preview's own painter.
 */
export default function AtlasTool() {
  useSurface('darkroom');
  const lib = useAssetLibrary();
  const [settings, update, reset] = useAtlasSettings();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [freeView, setFreeView] = useState<AtlasView | null>(null);
  // The tiles switch is OFF every time the atlas opens (`local-first.md`).
  const [tilesOn, setTilesOnState] = useState(false);
  const [paintSeq, setPaintSeq] = useState(0);

  const sources = useMemo<FlightSource[]>(
    () =>
      selectedUsableAssets(ATLAS_KINDS, lib.assets, lib.selection).flatMap((a) =>
        a.parts.srt ? [{ id: a.id, name: a.baseName, srt: a.parts.srt, video: a.parts.video ?? null }] : [],
      ),
    [lib.assets, lib.selection],
  );
  const { flights, reading, empty, aircraft } = useAtlasFlights(sources);
  const scene = useAtlasScene(flights, hidden, settings, freeView, aircraft);

  const clock = useRef(new PlayClock()).current;
  useEffect(() => clock.setTotal(scene.schedule.total), [clock, scene.schedule.total]);
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

  const look = useMemo(() => ({ bearing: settings.camera.bearing, tilt: settings.camera.tilt }), [settings.camera.bearing, settings.camera.tilt]);

  const empties = flights.length === 0 && !reading;

  return (
    <section className="@container flex-1 min-h-0 flex flex-col" aria-label="Flight Atlas">
      <div className="flex-1 min-h-0 flex flex-col gap-3 @min-[860px]:grid @min-[860px]:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-2 min-h-0 min-w-0 flex-[1.4] @min-[860px]:flex-none">
          <div className="flex-none flex flex-wrap items-center gap-2 px-2 py-1.5 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
            <span className="font-semibold text-sm">Flight Atlas</span>
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
            />
            {empties && (
              <div className="absolute inset-0 grid place-items-center p-6 pointer-events-none">
                <p className="m-0 max-w-sm text-center text-sm text-on-media bg-black/55 px-4 py-3 rounded-paper">
                  Select DJI clips — or loose <code className="font-mono">.srt</code> logs — in the Library, or add them from the panel: every
                  flight&rsquo;s GPS track is drawn here, never its video.
                </p>
              </div>
            )}
          </div>
          <AtlasTransport clock={clock} activity={scene.core.activity} />
        </div>
        <aside className="flex-1 min-h-0 overflow-y-auto overscroll-contain border border-line rounded-paper-lg bg-surface shadow-paper-soft px-3 @min-[860px]:flex-none" aria-label="Flight Atlas settings">
          <AtlasInspector
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
            onAddFiles={lib.addFiles}
            tilesOn={tilesOn}
            setTilesOn={setTilesOn}
            onFit={onFit}
            drawingZone={drawingZone}
            setDrawingZone={setDrawingZone}
            onZoneFromView={onZoneFromView}
            aircraftFound={scene.aircraftFound}
            unnamed={scene.unnamed}
            dateRange={scene.core.dateRange}
            total={scene.schedule.total}
            exporter={exporter}
            onExport={onExport}
          />
        </aside>
      </div>
    </section>
  );
}
