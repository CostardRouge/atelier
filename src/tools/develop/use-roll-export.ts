import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { pictureAspectRatio } from '../../shared/develop/crop-aspect';
import {
  deliverySummary,
  describeRun,
  exportName,
  type DeliverySummary,
  type PictureSize,
} from '../../shared/develop/roll-export';
import { measurePicture, renderRollPicture, type MeasuredPicture } from '../../shared/develop/roll-render';
import { delivers, variantFolder, type RollDoc, type RollPicture } from '../../shared/develop/roll-types';
import type { Interpolation } from '../../shared/lut/interpolate';
import { rollCubes } from './roll-cubes';
import { WORKING_PREVIEW_EDGE, isWorkingPreview } from '../../shared/develop/working-preview';
import { knownIdentity, mediaOrigin } from '../../shared/projects/media-identity';
import { isProxyOverRaw, originalOf, rawRenderOf } from '../../shared/develop/delivery-source';
import { deliverFilesTo, pickDeliveryTarget, type FolderedFile } from '../../shared/sources/deliver-files';
import { largestSize, targetFolder } from '../../shared/develop/export-targets';
import { profileInEffect } from '../../shared/lens/lens-profile';
import { uniqueName } from '../../shared/sources/unique-name';
import { EXIF_SLICE_BYTES, parseExif, type ExifData, type GpsCoord } from '../../shared/exif/exif-parser';
import { captureYear } from '../../shared/exif/delivery-meta';
import { resolveWatermarkText, type Watermark } from '../../shared/develop/watermark';
import { exportExifBlock, stampExif, type ExifAccount } from '../../shared/exif/stamp-exif';
import { keepsCapture } from '../../shared/exif/meta-groups';
import { PLACE_MAX_KM, placeFor, type DeliveryPlace } from '../../shared/exif/delivery-place';
import { gazetteerOrEmpty } from '../../shared/roadtrip/load-gazetteer';

/** The pictures whose watermark said nothing — said once, with what would fill it. */
function markNote(names: readonly string[]): string[] {
  if (names.length === 0) return [];
  const who = names.length === 1 ? names[0] : `${names.length} pictures`;
  return [`${who} left without a watermark: its line says nothing yet — set a creator in Metadata, or write the line out`];
}

/** A capture's EXIF read from the head of its original, or null when it will not parse. */
function exifOf(head: Uint8Array): ExifData | null {
  try {
    return parseExif(head.buffer.slice(head.byteOffset, head.byteOffset + head.byteLength));
  } catch {
    return null;
  }
}

/** The pictures that had a position and no place near enough to name — said once, not per file. */
function placeNote(names: readonly string[]): string[] {
  if (names.length === 0) return [];
  const who = names.length === 1 ? names[0] : `${names.length} pictures`;
  return [`${who} had no named town within ${PLACE_MAX_KM} km of its position — no city was written`];
}
import { useDeliveryIdentity } from '../../shared/develop/use-preset-book';
import { heldOriginal, heldVersion, holdOriginal, subscribeHeld } from '../../shared/sources/original-cache';
import { formatBytes } from '../../shared/lib/format';
import {
  BASE_LABELS,
  baseRung,
  developBase,
  isRawDevelop,
  rawGainOf,
  withoutBase,
} from '../../shared/develop/develop';
import {
  calibrationAt,
  readRawCalibration,
  topRung,
  type RawCalibration,
} from '../../shared/raw/calibration';
import { deliveredSourceFor, fetchSourceFile, sensorSourceFor } from '../../shared/develop/sensor-source';
import { trackedFetch } from '../../shared/tasks/tracked';
import { startTask } from '../../shared/tasks/tasks';
import { planRun, type PictureFacts, type RunPlan } from '../../shared/develop/run-plan';

/**
 * What the last run rendered, and each file's own capture on its instance.
 *
 * Recorded, not shown: sending the finals home is unplugged (`ExportPanel`),
 * because Winnow's upload route files an upload into the incoming as a new
 * capture instead of into the Gallery, and ignores the `original_asset_id`
 * that would link it to the picture it was developed from. The bookkeeping
 * stays so re-plugging it is one element, not a second pass over the loop.
 */
export interface RollRun {
  files: File[];
  /** Each file's own capture on its instance, parallel to `files`. */
  assetIds: (string | null)[];
  /** The one instance the run's pictures came from, when they came from one. */
  sourceId: string | null;
  /** The HDR delivery, when the roll asked for one: how many files carry a gain map, and the most it lifts. */
  hdr: { asked: number; ultra: number; headroom: number; checked: number | null } | null;
}

export interface RollExports {
  /** A running export's progress line, or null when idle. */
  exporting: string | null;
  /** The last run's outcome, in a sentence. */
  note: string | null;
  lastRun: RollRun | null;
  /** What the OPEN picture will deliver, or null until its size is known. */
  openDelivery: DeliverySummary | null;
  /**
   * The open picture's FILE size in pixels, once measured — the crop's tag
   * reads it, and so does the fidelity chip, which says whether those pixels
   * are the file's own or the render inside a RAW.
   */
  openSize: MeasuredPicture | null;
  /** What the whole run will deliver, picture by picture, and the bytes it costs — before a byte is fetched. */
  plan: RunPlan;
  /** Every picture's run-plan line by id, leaving or not — the Export tab's table. */
  lines: ReadonlyMap<string, string>;
  /** Render the pictures named and hand them over. */
  exportPictures: (ids: readonly string[]) => Promise<void>;
}

/**
 * The roll's still exports (D9 of `docs/develop-tool.md`): each picture
 * decoded whole, graded through its OWN cube (its develop under its own
 * look, roll v5), framed as the crop stage showed it and written as a JPEG at the
 * roll's quality — into a folder, or downloaded where no picker exists.
 *
 * Which pixels is decided per picture by `deliverySummary`
 * (`docs/develop-originals.md` §7): Auto fetches a proxy's original only
 * where the proxy could not fill the frame asked for, an original the
 * browser cannot decode (a RAW) is never fetched, and a fetched original is
 * held for the session so a second export does not pull it again.
 */
export function useRollExport({
  roll,
  files,
  fileFor,
  openId,
  interpolation,
  siblingsOf,
  proxiesOnly = false,
  onDelivered,
}: {
  roll: RollDoc;
  files: ReadonlyMap<string, File>;
  /** A picture's bytes for the run, fetched on the spot when they are not in hand. */
  fileFor: (picture: RollPicture) => Promise<File | null>;
  openId: string | null;
  /** The lattice lookup the stage bakes with — the export must bake the same (`interpolate.ts`). */
  interpolation: Interpolation;
  /** The capture files a folder listed beside a local picture (`AssetParts.siblings`) — where its RAW may be. */
  siblingsOf?: (file: File) => readonly File[];
  /**
   * *Proxies only, for this run* (`docs/capture-renditions.md` §13.2): every
   * picture leaves from what is in hand, a RAW base set aside and said. A
   * run-time choice, never on the document — "not now, not on this
   * connection" is about this machine, not about the roll.
   */
  proxiesOnly?: boolean;
  /**
   * The pictures whose files LANDED, as they were rendered, and when — what
   * the export marks record (`export-marks.ts`). A file the folder refused is
   * not among them.
   */
  onDelivered?: (pictures: readonly RollPicture[], at: number) => void;
}): RollExports {
  const [exporting, setExporting] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RollRun | null>(null);
  // Who signs the files (`exif/delivery-meta.ts`), read at the moment a run
  // stamps each one — the book it lives in may still be loading at mount.
  const identity = useDeliveryIdentity();
  const latest = useRef({ roll, files, fileFor, interpolation, siblingsOf, proxiesOnly, identity, onDelivered });
  latest.current = { roll, files, fileFor, interpolation, siblingsOf, proxiesOnly, identity, onDelivered };

  // What the run will deliver, picture by picture, before a byte is fetched.
  // Re-planned whenever the session holds something new — the stage fetching
  // a file is what turns "to fetch" into "in hand".
  const held = useSyncExternalStore(subscribeHeld, heldVersion);
  const { plan, lines } = useMemo<{ plan: RunPlan; lines: ReadonlyMap<string, string> }>(() => {
    const factsFor = (picture: RollPicture): PictureFacts => {
      const file = files.get(picture.id) ?? null;
      if (!file) return { file: null, proxy: false, sensor: null, delivered: null, original: null };
      const origin = mediaOrigin(file);
      const assetId = knownIdentity(file)?.assetId ?? null;
      const beside = siblingsOf?.(file) ?? [];
      const proxy = origin?.fidelity === 'proxy';
      return {
        file,
        proxy,
        sensor: sensorSourceFor(file, origin, beside, assetId),
        delivered: deliveredSourceFor(picture.rendition, file, origin, beside, assetId),
        original:
          proxy && origin?.name
            ? { name: origin.name, bytes: origin.bytes ?? null, held: assetId ? heldOriginal(assetId) !== null : false }
            : null,
      };
    };
    // The run the roll's own verb makes: the pictures that LEAVE
    // (`delivers`) — the sentence must not count one held or ignored.
    // Every picture's own line, for the Export tab's table: a picture held
    // back still says what it WOULD leave from, which is what decides it.
    const every = planRun(roll.pictures, factsFor, proxiesOnly, formatBytes);
    return {
      plan: planRun(roll.pictures.filter(delivers), factsFor, proxiesOnly, formatBytes),
      lines: new Map(every.pictures.map((p) => [p.id, p.line])),
    };
  }, [roll.pictures, files, siblingsOf, proxiesOnly, held]);

  // --- the open picture's own size, measured once per file, for the Delivers line
  const [openSize, setOpenSize] = useState<{ file: File; size: MeasuredPicture } | null>(null);
  const openFile = openId ? (files.get(openId) ?? null) : null;
  useEffect(() => {
    if (!openFile) return;
    let alive = true;
    void measurePicture(openFile).then((size) => {
      if (alive && size) setOpenSize({ file: openFile, size });
    });
    return () => {
      alive = false;
    };
  }, [openFile]);

  // How big the render inside the open picture's RAW original is. Read once
  // per picture, from a megabyte of its head — the row must say what the RUN
  // will really deliver, and the run takes the larger of that render and the
  // proxy. Only for a proxy over a RAW; nothing else costs a byte.
  const [rawRender, setRawRender] = useState<{ file: File; size: PictureSize | null } | null>(null);
  useEffect(() => {
    const origin = mediaOrigin(openFile);
    if (!openFile || !origin || !isProxyOverRaw(origin)) return;
    let alive = true;
    void rawRenderOf(origin, knownIdentity(openFile)?.assetId ?? null).then(({ render }) => {
      if (alive) setRawRender({ file: openFile, size: render });
    });
    return () => {
      alive = false;
    };
  }, [openFile]);

  // What the OPEN picture's own file is calibrated for — from the RAW in
  // hand: the file itself, or an original already held. Nothing is fetched
  // for a sentence; without it the row simply says less.
  const [rawCal, setRawCal] = useState<{ file: File; cal: RawCalibration | null } | null>(null);
  useEffect(() => {
    if (!openFile) return;
    const source = sensorSourceFor(openFile, mediaOrigin(openFile), siblingsOf?.(openFile) ?? [], knownIdentity(openFile)?.assetId ?? null)?.held ?? null;
    if (!source) return;
    let alive = true;
    void readRawCalibration(source).then((cal) => {
      if (alive) setRawCal({ file: openFile, cal });
    });
    return () => {
      alive = false;
    };
  }, [openFile, siblingsOf]);

  const open = openId ? (roll.pictures.find((p) => p.id === openId) ?? null) : null;
  let openDelivery: DeliverySummary | null = null;
  if (open && openFile && openSize && openSize.file === openFile) {
    const origin = mediaOrigin(openFile);
    openDelivery = deliverySummary(
      openSize.size,
      origin?.fidelity === 'proxy',
      originalOf(origin, rawRender?.file === openFile ? rawRender.size : null),
      open.framing,
      pictureAspectRatio(open.aspect, openSize.size.width, openSize.size.height),
      open.border,
      // The FIRST target's size: the one this folder itself receives.
      { size: roll.export.targets[0]?.size ?? null, pixels: proxiesOnly ? 'proxies' : 'auto' },
    );
    const chosen = proxiesOnly
      ? null
      : deliveredSourceFor(open.rendition, openFile, origin, siblingsOf?.(openFile) ?? [], knownIdentity(openFile)?.assetId ?? null);
    if (chosen && !isRawDevelop(open.develop)) {
      // The picture's own answer: the file set above the photograph, at its
      // own size — measured when it is fetched, never planned from the proxy.
      openDelivery = {
        ...openDelivery,
        from: 'original',
        line: `${chosen.name} · as chosen${chosen.held ? '' : chosen.bytes ? ` · ${formatBytes(chosen.bytes)} to fetch` : ''}`,
        reason: 'delivered from the file chosen above the photograph, at its own size',
      };
    } else if (proxiesOnly && isRawDevelop(open.develop)) {
      openDelivery = { ...openDelivery, reason: 'proxies only for this run — its RAW base is set aside and the numbers act on the proxy' };
    } else if (isRawDevelop(open.develop)) {
      // The row was measured on the render; a RAW develop leaves from the
      // sensor's data at its own density, and the reason says so — including
      // the one way the file can differ from the stage: the export climbs to
      // the top rung the file carries, and a picture left standing on `gain`
      // will deliver a calibration the preview did not show.
      const at = developBase(open.develop);
      const top = rawCal?.file === openFile ? topRung(rawCal.cal) : at;
      openDelivery = {
        ...openDelivery,
        reason:
          baseRung(top) > baseRung(at)
            ? `developed on its RAW at ${BASE_LABELS[at]} — the export climbs to ${BASE_LABELS[top]}, the calibration its own file carries, so the file will differ from the stage`
            : `developed on its RAW at ${BASE_LABELS[at]} — delivered from the sensor’s data, decoded at its own size`,
      };
    }
  }

  const exportPictures = useCallback(async (ids: readonly string[]) => {
    const { roll: r, files: f, fileFor: fetchFor, interpolation: mode, proxiesOnly: onlyProxies } = latest.current;
    // Each picture through ITS look, from the document — never the live
    // stack, which follows whatever picture is open while the run goes on.
    const cubeFor = rollCubes(mode);
    const targets = ids.flatMap((id) => r.pictures.filter((p) => p.id === id));
    if (targets.length === 0) return;
    setNote(null);
    // The folder FIRST, from the click itself: the picker opens only while
    // the browser still honours that click, about five seconds, and a roll
    // takes longer than that to render (`deliver-files.ts`).
    let target;
    try {
      target = await pickDeliveryTarget();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'No folder could be chosen.');
      return;
    }
    if (!target) {
      setNote('No folder was chosen — nothing was rendered.');
      return;
    }
    setExporting('Preparing…');
    // The run as a TASK (`tasks.md`, T4): one per run, a picture at a time on
    // its bar, a Cancel that stops BETWEEN two pictures — and ends a fetch or
    // a RAW decode in flight — and keeps what was rendered (his question 2).
    const controller = new AbortController();
    const task = startTask({
      label: targets.length === 1 ? `Exporting ${targets[0].ref.name}` : `Exporting ${targets.length} pictures`,
      progress: 0,
      cancel: () => controller.abort(),
    });
    const rendered: File[] = [];
    // The other targets' files, each bound for its own sub-folder under the
    // SAME name as the picture's file in the chosen folder.
    const foldered: FolderedFile[] = [];
    // The picture each file was rendered from, parallel to `rendered`.
    const renderedFrom: RollPicture[] = [];
    // And the sub-folder it goes to, parallel too: '' for a picture, `Variant
    // 2` for a copy (item 30), whose file keeps the capture's exact name.
    const renderedFolder: string[] = [];
    const assetIds: (string | null)[] = [];
    const sourceIds = new Set<string>();
    const failures: string[] = [];
    const hdrRun = r.export.hdr ? { asked: 0, ultra: 0, headroom: 0, checked: null as number | null } : null;
    // The place index (`delivery-place.ts`), loaded once per run and only when
    // the roll writes a place: 2 MB from our own origin, never at boot. An
    // index that will not load names nothing, and the run says so below.
    let placeOf: ((gps: GpsCoord) => DeliveryPlace | null) | undefined;
    const unplaced: string[] = [];
    // Pictures whose watermark line came out empty — no creator set, no title.
    const unmarked: string[] = [];
    if (r.export.metadata.place) {
      setExporting('Loading the place index…');
      const cities = await gazetteerOrEmpty();
      placeOf = (gps) => placeFor(cities, gps);
    }
    // A run names each file after its picture, so two crops of ONE picture
    // want one name: the second is numbered here, before the folder is even
    // chosen. Case-folded, like the volume it will land on.
    const named = new Set<string>();
    try {
      for (const [i, picture] of targets.entries()) {
        if (controller.signal.aborted) break;
        const step = `${i + 1}/${targets.length}`;
        task.update({ progress: i / targets.length, detail: `${step} · ${picture.ref.name}` });
        let file = f.get(picture.id) ?? null;
        if (!file) {
          setExporting(`Fetching ${step}…`);
          file = await fetchFor(picture);
        }
        if (!file) {
          failures.push(`${picture.ref.name} could not be found — not in the Library, and no connected instance holds it`);
          continue;
        }
        // A working preview is a 2048 px stand-in, never a deliverable: a
        // file at that size under the picture's own name would sit in his
        // Gallery folder beside the original as if it were the picture. Left
        // out and said, so the folder gets reopened and the run redone.
        if (isWorkingPreview(file)) {
          failures.push(
            `${picture.ref.name} was left out: only its ${WORKING_PREVIEW_EDGE} px working preview is in hand — reopen the roll’s folder and export again`,
          );
          continue;
        }
        try {
          setExporting(`Measuring ${step}…`);
          const origin = mediaOrigin(file);
          const identity = knownIdentity(file);
          let source = file;
          // A picture developed on its RAW leaves from the sensor's data: the
          // file itself when it is the RAW, else the proxy's original, held
          // for the session like any fetched original (decision 3). Not
          // reachable, the render leaves instead and the run says so —
          // never the RAW with numbers nobody has seen on it, and never
          // silently the wrong material.
          const beside = latest.current.siblingsOf?.(file) ?? [];
          let raw: { file: File; gain: number } | null = null;
          if (isRawDevelop(picture.develop)) {
            if (onlyProxies) {
              failures.push(`${picture.ref.name} left from its proxy: proxies only for this run, its RAW base set aside`);
            } else {
              // The one answer the stage gave (`sensor-source.ts`): the file,
              // a folder sibling, the proxy's original or the capture's companion.
              const sensor = sensorSourceFor(file, origin, beside, identity?.assetId ?? null);
              let rawFile: File | null = null;
              if (sensor) {
                if (!sensor.held) setExporting(`Fetching ${sensor.name} ${step}${sensor.bytes ? ` · ${formatBytes(sensor.bytes)}` : ''}…`);
                rawFile = await fetchSourceFile(sensor, identity?.assetId ?? null, controller.signal).catch(() => null);
              }
              if (controller.signal.aborted) break;
              if (rawFile) raw = { file: rawFile, gain: rawGainOf(picture.develop) };
              else failures.push(`${picture.ref.name} is developed on its RAW, which is not reachable here — its render left instead`);
            }
          }
          // The file set above the photograph (`RollPicture.rendition`) is
          // the picture's own answer to which pixels: fetched once and held,
          // exactly as the stage did. Below the sensor only, and never under
          // "proxies only".
          const chosen = !raw && !onlyProxies ? deliveredSourceFor(picture.rendition, file, origin, beside, identity?.assetId ?? null) : null;
          if (chosen) {
            if (!chosen.held) setExporting(`Fetching ${chosen.name} ${step}${chosen.bytes ? ` · ${formatBytes(chosen.bytes)}` : ''}…`);
            try {
              source = await fetchSourceFile(chosen, identity?.assetId ?? null, controller.signal);
            } catch {
              // The run's own cancel ended this fetch: not a failure to list.
              if (controller.signal.aborted) break;
              failures.push(`${picture.ref.name}: ${chosen.name} could not be fetched — what is in hand left instead`);
            }
          }
          // WITHIN the RAW rungs, the export climbs to the top one the file
          // can give: the calibration is the body's own, it is two GPU passes,
          // and there is no reason to deliver less of it than exists. It
          // never crosses proxy → gain, which is decision 4 and the rule
          // `raw.md` states twice: numbers nobody has seen on the sensor's
          // data are never applied to it by an export.
          let calibration = null as ReturnType<typeof calibrationAt> | null;
          if (raw) {
            const cal = await readRawCalibration(raw.file);
            calibration = calibrationAt(topRung(cal), cal);
          }
          // Decide from the file's own pixels which pixels to deliver from.
          // Where nothing above decided, `Auto`'s arithmetic still does — never
          // fewer pixels than a reachable original would give the frame — and
          // "proxies only" turns it off.
          const undecided = !raw && source === file;
          const size = raw ? null : await measurePicture(file);
          // A RAW original hands over the RENDER inside it and nothing else,
          // so its size is read from the head before anything is decided —
          // that head then pays for the EXIF too. Without this the delivery
          // would be guessing, and decision 4's guess (the embedded render
          // wins) is measurably wrong on the maintainer's own DJI.
          let rawHead: Uint8Array | null = null;
          let originalRender: PictureSize | null = null;
          if (size && undecided && !onlyProxies && isProxyOverRaw(origin)) {
            setExporting(`Reading the RAW’s head ${step}…`);
            const probed = await rawRenderOf(origin!, identity?.assetId ?? null);
            originalRender = probed.render;
            rawHead = probed.head;
          }
          if (size && undecided && origin?.fidelity === 'proxy' && origin.fetchOriginal) {
            const summary = deliverySummary(
              size,
              true,
              originalOf(origin, originalRender),
              picture.framing,
              pictureAspectRatio(picture.aspect, size.width, size.height),
              picture.border,
              // The LARGEST target decides whether the original is worth
              // fetching: every target is cut from the one render.
              { size: largestSize(r.export.targets), pixels: onlyProxies ? 'proxies' : 'auto' },
            );
            if (summary.from === 'original') {
              const held = identity?.assetId ? heldOriginal(identity.assetId) : null;
              if (held) {
                source = held;
              } else {
                setExporting(
                  `Fetching the original ${step}${origin.bytes ? ` · ${formatBytes(origin.bytes)}` : ''}…`,
                );
                const fetchOriginal = origin.fetchOriginal;
                source = await trackedFetch(
                  { label: `Fetching ${origin.name ?? 'the original'}`, scope: identity?.assetId ?? null, bytes: origin.bytes ?? null, signal: controller.signal },
                  (opts) => fetchOriginal(opts),
                );
                if (identity?.assetId) holdOriginal(identity.assetId, source);
              }
            }
          }
          // The EXIF comes from the ORIGINAL whatever the pixels came from
          // (`shared/exif/stamp-exif.ts`): the original itself when the run
          // has it, else its head alone — a quarter of a megabyte instead of
          // the whole capture — else what the instance vouched for. A RAW
          // leaving from its own file is that original.
          const key = identity?.assetId ?? null;
          const originalFile =
            raw?.file ?? (source !== file ? source : origin?.fidelity === 'proxy' ? (key ? heldOriginal(key) : null) : file);
          let head: Uint8Array | null = rawHead;
          if (originalFile) {
            head = new Uint8Array(await originalFile.slice(0, EXIF_SLICE_BYTES).arrayBuffer());
          } else if (!head && origin?.fetchOriginalHead) {
            setExporting(`Reading the original’s EXIF ${step}…`);
            head = await origin
              .fetchOriginalHead(EXIF_SLICE_BYTES)
              .then((buffer) => new Uint8Array(buffer))
              .catch(() => null);
          }

          setExporting(raw ? `Decoding the RAW ${step}…` : `Rendering ${step}…`);
          // A RAW develop whose RAW is out of reach renders its numbers on the
          // render WITHOUT the base: the gain belongs to the sensor's range.
          const develop = raw ? picture.develop : picture.develop && isRawDevelop(picture.develop) ? withoutBase(picture.develop) : picture.develop;
          // The HDR delivery needs the sensor's data: an 8-bit render holds
          // nothing above white, and a map made from one would be flat. So
          // it is asked only of a picture leaving from its RAW, and the run
          // says which ones did not.
          let hdr: { lut: CubeLut | null; stops: number } | null = null;
          if (hdrRun) {
            if (raw && develop) {
              hdrRun.asked += 1;
              const stops = r.export.hdrStops;
              hdr = { lut: await cubeFor(picture.grade ?? null, { ...develop, exposure: develop.exposure - stops }), stops };
            } else {
              failures.push(`${picture.ref.name} left as a plain JPEG: HDR needs the RAW base, a render holds nothing above white`);
            }
          }
          // The EXIF is stamped INSIDE the render (`RollRenderOptions.stamp`),
          // on the base JPEG before any HDR container is written round it;
          // its account is kept here for the run's sentence.
          const stamped: { account: ExifAccount } = { account: 'none' };
          const stamp = async (jpeg: Blob, delivered: PictureSize) => {
            const exif = exportExifBlock(head, origin?.exif ?? null, delivered, {
              identity: latest.current.identity,
              title: picture.title,
              caption: picture.caption,
              keep: r.export.metadata,
              placeOf,
            });
            stamped.account = exif.account;
            if (placeOf && exif.located && !exif.place?.city) unplaced.push(picture.ref.name);
            return stampExif(jpeg, exif, delivered);
          };
          // The watermark's line for THIS picture: the identity, the year it
          // was taken, its own title. Resolved only when a target draws it.
          let watermark: { text: string; style: Watermark } | null = null;
          if (r.export.targets.some((t) => t.watermark)) {
            const capture = head ? exifOf(head) : null;
            const year = captureYear(capture?.dateTimeOriginal ?? origin?.exif?.dateTimeOriginal, new Date().getFullYear());
            const text = resolveWatermarkText(r.export.watermark.text, {
              creator: latest.current.identity?.creator ?? null,
              year,
              title: picture.title ?? null,
            });
            if (text) watermark = { text, style: r.export.watermark };
            else unmarked.push(picture.ref.name);
          }
          const out = await renderRollPicture(source, {
            watermark,
            signal: controller.signal,
            framing: picture.framing,
            aspect: picture.aspect,
            border: picture.border,
            lut: await cubeFor(picture.grade ?? null, develop),
            targets: r.export.targets,
            keystone: picture.keystone ?? null,
            lens: picture.lens ?? null,
            // On the sensor by itself; on a camera render only where the
            // author said so — a body's JPEG is often corrected already.
            lensProfile: profileInEffect(picture.lensProfile, Boolean(raw)),
            layers: picture.layers ?? null,
            detail: picture.detail ?? null,
            vignette: picture.vignette ?? null,
            repair: picture.repair ?? null,
            // The picture's own texture, part of its look (roll v5). The
            // document's copy, which the write-through keeps level with the stack.
            film: picture.grade?.film ?? null,
            raw,
            calibration,
            hdr,
            stamp,
            onSubjects: () => setExporting(`Finding the subject ${step}…`),
          });
          // A subject layer the model did not answer draws nothing — in the
          // file as on the stage — so the run says which picture left without it.
          const lost = out.subjects ? out.subjects.asked - out.subjects.resolved : 0;
          if (lost > 0) {
            failures.push(
              `${picture.ref.name} left without ${lost === 1 ? 'its subject mask' : `${lost} subject masks`}: the model could not be loaded or did not answer`,
            );
          }
          if (hdrRun && out.hdr) {
            if (out.hdr.ultra) {
              hdrRun.ultra += 1;
              hdrRun.headroom = Math.max(hdrRun.headroom, out.hdr.headroom);
              if (out.hdr.checked !== null) hdrRun.checked = Math.max(hdrRun.checked ?? 0, out.hdr.checked);
            } else {
              failures.push(`${picture.ref.name} left as a plain JPEG: ${out.hdr.reason ?? 'no gain map'}`);
            }
          }
          if (out.gradedAt.width < out.source.width || out.gradedAt.height < out.source.height) {
            failures.push(
              `${picture.ref.name} was graded at ${out.gradedAt.width}×${out.gradedAt.height}, the most this GPU renders on one edge — its ${out.source.width}×${out.source.height} were resampled`,
            );
          }
          // A RAW decoded under its sensor's pixels says which limit it met:
          // a phone's own ceiling is not the GPU's, and a computer delivers
          // the same picture whole.
          if (out.capped && out.sensor) {
            failures.push(
              out.capped === 'device'
                ? `${picture.ref.name} was delivered at ${out.source.width}×${out.source.height} from its ${out.sensor.width}×${out.sensor.height} sensor — as far as this device’s memory goes; a computer delivers it whole`
                : `${picture.ref.name} was delivered at ${out.source.width}×${out.source.height} from its ${out.sensor.width}×${out.sensor.height} sensor — the most this GPU renders on one edge`,
            );
          }
          // Said, not hidden: a file that lost its position is worth knowing
          // about before it is filed away.
          // Only where the choice asked for what was missing: a Minimal run
          // never wanted the body, so its absence is no news.
          if (stamped.account === 'vouched' && r.export.metadata.camera) {
            failures.push(
              `${picture.ref.name} took its EXIF from ${origin?.sourceId ?? 'the source'}’s record — the original was out of reach, so no body or lens`,
            );
          } else if (stamped.account === 'none' && keepsCapture(r.export.metadata)) {
            failures.push(`${picture.ref.name} carries no camera EXIF — nothing is known about the picture it came from, only the signature is written`);
          }
          const blob = out.blob;
          // Unique within its own folder: a variant's `Variant 2/DJI_0101.jpg`
          // does not collide with the first's `DJI_0101.jpg`.
          const variantDir = variantFolder(picture);
          const inDir = (n: string) => `${variantDir}/${n}`.toLowerCase();
          const name = uniqueName(exportName(picture.ref.name), (c) => named.has(inDir(c)));
          named.add(inDir(name));
          rendered.push(
            new File([blob], name, {
              type: 'image/jpeg',
              // The capture's own instant, never the moment it was rendered.
              lastModified: file.lastModified,
            }),
          );
          out.outputs.slice(1).forEach((o, k) => {
            const targetDir = targetFolder(r.export.targets[k + 1].name, k + 1);
            foldered.push({
              folder: variantDir ? `${targetDir}/${variantDir}` : targetDir,
              file: new File([o.blob], name, { type: 'image/jpeg', lastModified: file.lastModified }),
            });
          });
          renderedFrom.push(picture);
          renderedFolder.push(variantDir);
          assetIds.push(identity?.assetId ?? null);
          if (origin) sourceIds.add(origin.sourceId);
        } catch (err) {
          // Cancelled mid-picture: that picture is not a failure to list.
          if (controller.signal.aborted) break;
          failures.push(`${picture.ref.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const cancelled = controller.signal.aborted;
      if (rendered.length === 0) {
        setNote(cancelled ? 'Export cancelled — nothing was written.' : (failures[0] ?? 'Nothing could be rendered.'));
        return;
      }
      // A cancelled run keeps what it rendered: written, and said as such.
      setExporting('Writing…');
      task.update({ label: 'Writing the pictures', progress: 0, detail: null });
      const mains = rendered.map((file, i) => (renderedFolder[i] ? { file, folder: renderedFolder[i] } : file));
      const delivery = await deliverFilesTo(target, [...mains, ...foldered], {
        replace: r.export.replace,
        onProgress: (done, total) => {
          setExporting(`Writing ${done}/${total}…`);
          task.update({ progress: done / total, detail: `${done} of ${total}` });
        },
      });
      const errors = delivery.method === 'folder' ? delivery.errors : [];
      // What LANDED is what gets marked: a file the folder refused was not delivered.
      const refused = new Set(delivery.method === 'folder' ? delivery.failed : []);
      latest.current.onDelivered?.(
        renderedFrom.filter((_, i) => !refused.has(renderedFolder[i] ? `${renderedFolder[i]}/${rendered[i].name}` : rendered[i].name)),
        Date.now(),
      );
      const renamed = delivery.method === 'folder' ? delivery.renamed : 0;
      setNote(
        (cancelled ? `Cancelled after ${rendered.length} of ${targets.length} — ` : '') +
          describeRun(delivery.written, delivery.method, [...failures, ...placeNote(unplaced), ...markNote(unmarked), ...errors], renamed, {
            pictures: rendered.length,
            targets: r.export.targets.length,
          }),
      );
      // Only the files from ONE instance, so a future send-home plan refuses
      // nothing it did not have to.
      const sourceId = sourceIds.size === 1 ? [...sourceIds][0] : null;
      setLastRun({ files: rendered, assetIds, sourceId, hdr: hdrRun });
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'The pictures could not be exported.');
    } finally {
      task.done();
      setExporting(null);
    }
  }, []);

  const measuredOpen = openFile && openSize && openSize.file === openFile ? openSize.size : null;
  return { exporting, note, lastRun, openDelivery, openSize: measuredOpen, plan, lines, exportPictures };
}
