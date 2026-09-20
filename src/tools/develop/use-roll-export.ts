import { useCallback, useEffect, useRef, useState } from 'react';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { pictureAspectRatio } from '../../shared/develop/crop-aspect';
import {
  deliverySummary,
  describeRun,
  exportName,
  type DeliverySummary,
  type OriginalInfo,
  type PictureSize,
} from '../../shared/develop/roll-export';
import { measurePicture, renderRollPicture } from '../../shared/develop/roll-render';
import type { RollDoc, RollPicture } from '../../shared/develop/roll-types';
import { WORKING_PREVIEW_EDGE, isWorkingPreview } from '../../shared/develop/working-preview';
import { knownIdentity, mediaOrigin, type MediaOrigin } from '../../shared/projects/media-identity';
import { deliverFiles } from '../../shared/sources/deliver-files';
import { heldOriginal, holdOriginal } from '../../shared/sources/original-cache';
import { formatBytes } from '../../shared/lib/format';
import { isRawDevelop, rawGainOf, withoutBase } from '../../shared/develop/develop';
import { isRawImage } from '../../shared/library/assets';
import { canDecodeRaw } from '../../shared/raw/raw-decoder';

/** What the last run rendered, kept for one purpose: sending it home. */
export interface RollRun {
  files: File[];
  /** Each file's own capture on its instance, parallel to `files`. */
  assetIds: (string | null)[];
  /** The one instance the run's pictures came from, when they came from one. */
  sourceId: string | null;
}

export interface RollExports {
  /** A running export's progress line, or null when idle. */
  exporting: string | null;
  /** The last run's outcome, in a sentence. */
  note: string | null;
  lastRun: RollRun | null;
  /** What the OPEN picture will deliver, or null until its size is known. */
  openDelivery: DeliverySummary | null;
  /** The open picture's FILE size in pixels, once measured — the crop's tag reads it. */
  openSize: PictureSize | null;
  /** Render the pictures named and hand them over. */
  exportPictures: (ids: readonly string[]) => Promise<void>;
}

function originalOf(origin: MediaOrigin | null): OriginalInfo | null {
  if (!origin || origin.fidelity !== 'proxy') return null;
  return { width: origin.width, height: origin.height, name: origin.name ?? null, bytes: origin.bytes ?? null };
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
}: {
  roll: RollDoc;
  files: ReadonlyMap<string, File>;
  /** A picture's bytes for the run, fetched on the spot when they are not in hand. */
  fileFor: (picture: RollPicture) => Promise<File | null>;
  openId: string | null;
  lutFor: (picture: RollPicture) => CubeLut | null;
}): RollExports {
  const [exporting, setExporting] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RollRun | null>(null);
  const latest = useRef({ roll, files, fileFor, lutFor });
  latest.current = { roll, files, fileFor, lutFor };

  // --- the open picture's own size, measured once per file, for the Delivers line
  const [openSize, setOpenSize] = useState<{ file: File; size: PictureSize } | null>(null);
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

  const open = openId ? (roll.pictures.find((p) => p.id === openId) ?? null) : null;
  let openDelivery: DeliverySummary | null = null;
  if (open && openFile && openSize && openSize.file === openFile) {
    const origin = mediaOrigin(openFile);
    openDelivery = deliverySummary(
      openSize.size,
      origin?.fidelity === 'proxy',
      originalOf(origin),
      open.framing,
      pictureAspectRatio(open.aspect, openSize.size.width, openSize.size.height),
      open.border,
      roll.export,
    );
    if (isRawDevelop(open.develop)) {
      // The row was measured on the render; a RAW develop leaves from the
      // sensor's data at its own density, and the reason says so.
      openDelivery = {
        ...openDelivery,
        reason: 'developed on its RAW — delivered from the sensor’s data, decoded at its own size',
      };
    }
  }

  const exportPictures = useCallback(async (ids: readonly string[]) => {
    const { roll: r, files: f, fileFor: fetchFor, lutFor: cubeFor } = latest.current;
    const targets = ids.flatMap((id) => r.pictures.filter((p) => p.id === id));
    if (targets.length === 0) return;
    setNote(null);
    setExporting('Preparing…');
    const rendered: File[] = [];
    const assetIds: (string | null)[] = [];
    const sourceIds = new Set<string>();
    const failures: string[] = [];
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
        if (isWorkingPreview(file)) {
          failures.push(`${picture.ref.name} left from its working preview, ${WORKING_PREVIEW_EDGE} px at most`);
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
          let raw: { file: File; gain: number } | null = null;
          if (isRawDevelop(picture.develop)) {
            let rawFile: File | null = canDecodeRaw(file) ? file : null;
            if (!rawFile && origin?.name && isRawImage(origin.name) && origin.fetchOriginal) {
              const key = identity?.assetId ?? null;
              rawFile = key ? heldOriginal(key) : null;
              if (!rawFile) {
                setExporting(`Fetching the RAW ${step}${origin.bytes ? ` · ${formatBytes(origin.bytes)}` : ''}…`);
                rawFile = await origin.fetchOriginal();
                if (key) holdOriginal(key, rawFile);
              }
            }
            if (rawFile) raw = { file: rawFile, gain: rawGainOf(picture.develop) };
            else failures.push(`${picture.ref.name} is developed on its RAW, which is not reachable here — its render left instead`);
          }
          // Decide from the file's own pixels which pixels to deliver from.
          const size = raw ? null : await measurePicture(file);
          if (size && origin?.fidelity === 'proxy' && origin.fetchOriginal) {
            const summary = deliverySummary(
              size,
              true,
              originalOf(origin),
              picture.framing,
              pictureAspectRatio(picture.aspect, size.width, size.height),
              picture.border,
              r.export,
            );
            if (summary.from === 'original') {
              const key = identity?.assetId ?? null;
              const held = key ? heldOriginal(key) : null;
              if (held) {
                source = held;
              } else {
                setExporting(
                  `Fetching the original ${step}${origin.bytes ? ` · ${formatBytes(origin.bytes)}` : ''}…`,
                );
                source = await origin.fetchOriginal();
                if (key) holdOriginal(key, source);
              }
            }
          }
          setExporting(raw ? `Decoding the RAW ${step}…` : `Rendering ${step}…`);
          // A RAW develop whose RAW is out of reach renders its numbers on the
          // render WITHOUT the base: the gain belongs to the sensor's range.
          const develop = raw ? picture.develop : picture.develop && isRawDevelop(picture.develop) ? withoutBase(picture.develop) : picture.develop;
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
            raw,
          });
          if (out.gradedAt.width < out.source.width || out.gradedAt.height < out.source.height) {
            failures.push(
              `${picture.ref.name} was graded at ${out.gradedAt.width}×${out.gradedAt.height}, the most this GPU renders on one edge — its ${out.source.width}×${out.source.height} were resampled`,
            );
          }
          rendered.push(
            new File([out.blob], exportName(picture.ref.name, picture.aspect), {
              type: 'image/jpeg',
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
      const delivery = await deliverFiles(rendered, (done, total) => setExporting(`Writing ${done}/${total}…`));
      if (delivery.method === 'dismissed') return;
      const errors = delivery.method === 'folder' ? delivery.errors : [];
      setNote(describeRun(delivery.written, delivery.method, [...failures, ...errors]));
      // Kept for the send-home panel: only the files from ONE instance, so
      // the plan refuses nothing it did not have to.
      const sourceId = sourceIds.size === 1 ? [...sourceIds][0] : null;
      setLastRun({ files: rendered, assetIds, sourceId });
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'The pictures could not be exported.');
    } finally {
      setExporting(null);
    }
  }, []);

  const measuredOpen = openFile && openSize && openSize.file === openFile ? openSize.size : null;
  return { exporting, note, lastRun, openDelivery, openSize: measuredOpen, exportPictures };
}
