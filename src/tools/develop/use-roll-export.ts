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
import type { RollDoc, RollPicture } from '../../shared/develop/roll-types';
import { WORKING_PREVIEW_EDGE, isWorkingPreview } from '../../shared/develop/working-preview';
import { knownIdentity, mediaOrigin } from '../../shared/projects/media-identity';
import { isProxyOverRaw, originalOf, rawRenderOf } from '../../shared/develop/delivery-source';
import { deliverFilesTo, pickDeliveryTarget } from '../../shared/sources/deliver-files';
import { uniqueName } from '../../shared/sources/unique-name';
import { EXIF_SLICE_BYTES } from '../../shared/exif/exif-parser';
import { exportExifBlock, stampExif, type ExifAccount } from '../../shared/exif/stamp-exif';
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
  /** Render the pictures named and hand them over. */
  exportPictures: (ids: readonly string[]) => Promise<void>;
}

/**
 * The roll's still exports (D9 of `docs/develop-tool.md`): each picture
 * decoded whole, graded through its OWN cube (its develop under the roll's
 * look), framed as the crop stage showed it and written as a JPEG at the
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
  lutFor,
  siblingsOf,
  proxiesOnly = false,
}: {
  roll: RollDoc;
  files: ReadonlyMap<string, File>;
  /** A picture's bytes for the run, fetched on the spot when they are not in hand. */
  fileFor: (picture: RollPicture) => Promise<File | null>;
  openId: string | null;
  lutFor: (picture: RollPicture) => CubeLut | null;
  /** The capture files a folder listed beside a local picture (`AssetParts.siblings`) — where its RAW may be. */
  siblingsOf?: (file: File) => readonly File[];
  /**
   * *Proxies only, for this run* (`docs/capture-renditions.md` §13.2): every
   * picture leaves from what is in hand, a RAW base set aside and said. A
   * run-time choice, never on the document — "not now, not on this
   * connection" is about this machine, not about the roll.
   */
  proxiesOnly?: boolean;
}): RollExports {
  const [exporting, setExporting] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RollRun | null>(null);
  const latest = useRef({ roll, files, fileFor, lutFor, siblingsOf, proxiesOnly });
  latest.current = { roll, files, fileFor, lutFor, siblingsOf, proxiesOnly };

  // What the run will deliver, picture by picture, before a byte is fetched.
  // Re-planned whenever the session holds something new — the stage fetching
  // a file is what turns "to fetch" into "in hand".
  const held = useSyncExternalStore(subscribeHeld, heldVersion);
  const plan = useMemo<RunPlan>(() => {
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
    return planRun(roll.pictures, factsFor, proxiesOnly, formatBytes);
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
      { longEdge: roll.export.longEdge, pixels: proxiesOnly ? 'proxies' : 'auto' },
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
    const { roll: r, files: f, fileFor: fetchFor, lutFor: cubeFor, proxiesOnly: onlyProxies } = latest.current;
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
    const rendered: File[] = [];
    const assetIds: (string | null)[] = [];
    const sourceIds = new Set<string>();
    const failures: string[] = [];
    const hdrRun = r.export.hdr ? { asked: 0, ultra: 0, headroom: 0, checked: null as number | null } : null;
    // A run names each file after its picture, so two crops of ONE picture
    // want one name: the second is numbered here, before the folder is even
    // chosen. Case-folded, like the volume it will land on.
    const named = new Set<string>();
    try {
      for (const [i, picture] of targets.entries()) {
        const step = `${i + 1}/${targets.length}`;
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
                rawFile = await fetchSourceFile(sensor).catch(() => null);
              }
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
              source = await fetchSourceFile(chosen);
            } catch {
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
              { longEdge: r.export.longEdge, pixels: onlyProxies ? 'proxies' : 'auto' },
            );
            if (summary.from === 'original') {
              const held = identity?.assetId ? heldOriginal(identity.assetId) : null;
              if (held) {
                source = held;
              } else {
                setExporting(
                  `Fetching the original ${step}${origin.bytes ? ` · ${formatBytes(origin.bytes)}` : ''}…`,
                );
                source = await origin.fetchOriginal();
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
              hdr = { lut: cubeFor({ ...picture, develop: { ...develop, exposure: develop.exposure - stops } }), stops };
            } else {
              failures.push(`${picture.ref.name} left as a plain JPEG: HDR needs the RAW base, a render holds nothing above white`);
            }
          }
          // The EXIF is stamped INSIDE the render (`RollRenderOptions.stamp`),
          // on the base JPEG before any HDR container is written round it;
          // its account is kept here for the run's sentence.
          const stamped: { account: ExifAccount } = { account: 'none' };
          const stamp = async (jpeg: Blob, delivered: PictureSize) => {
            const exif = exportExifBlock(head, origin?.exif ?? null, delivered);
            stamped.account = exif.account;
            return stampExif(jpeg, exif, delivered);
          };
          const out = await renderRollPicture(source, {
            framing: picture.framing,
            aspect: picture.aspect,
            border: picture.border,
            lut: cubeFor({ ...picture, develop }),
            longEdge: r.export.longEdge,
            quality: r.export.quality,
            keystone: picture.keystone ?? null,
            lens: picture.lens ?? null,
            layers: picture.layers ?? null,
            detail: picture.detail ?? null,
            repair: picture.repair ?? null,
            // The ROLL's texture, not the picture's: grain and halation belong
            // to the stock, which dresses the whole roll. The document's copy,
            // which the write-through keeps level with the stack.
            film: r.grade?.film ?? null,
            raw,
            calibration,
            hdr,
            stamp,
          });
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
          // Said, not hidden: a file that lost its position is worth knowing
          // about before it is filed away.
          if (stamped.account === 'vouched') {
            failures.push(
              `${picture.ref.name} took its EXIF from ${origin?.sourceId ?? 'the source'}’s record — the original was out of reach, so no body or lens`,
            );
          } else if (stamped.account === 'none') {
            failures.push(`${picture.ref.name} carries no EXIF — nothing is known about the picture it came from`);
          }
          const blob = out.blob;
          const name = uniqueName(exportName(picture.ref.name), (c) => named.has(c.toLowerCase()));
          named.add(name.toLowerCase());
          rendered.push(
            new File([blob], name, {
              type: 'image/jpeg',
              // The capture's own instant, never the moment it was rendered.
              lastModified: file.lastModified,
            }),
          );
          assetIds.push(identity?.assetId ?? null);
          if (origin) sourceIds.add(origin.sourceId);
        } catch (err) {
          failures.push(`${picture.ref.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (rendered.length === 0) {
        setNote(failures[0] ?? 'Nothing could be rendered.');
        return;
      }
      setExporting('Writing…');
      const delivery = await deliverFilesTo(target, rendered, {
        replace: r.export.replace,
        onProgress: (done, total) => setExporting(`Writing ${done}/${total}…`),
      });
      const errors = delivery.method === 'folder' ? delivery.errors : [];
      const renamed = delivery.method === 'folder' ? delivery.renamed : 0;
      setNote(describeRun(delivery.written, delivery.method, [...failures, ...errors], renamed));
      // Only the files from ONE instance, so a future send-home plan refuses
      // nothing it did not have to.
      const sourceId = sourceIds.size === 1 ? [...sourceIds][0] : null;
      setLastRun({ files: rendered, assetIds, sourceId, hdr: hdrRun });
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'The pictures could not be exported.');
    } finally {
      setExporting(null);
    }
  }, []);

  const measuredOpen = openFile && openSize && openSize.file === openFile ? openSize.size : null;
  return { exporting, note, lastRun, openDelivery, openSize: measuredOpen, plan, exportPictures };
}
