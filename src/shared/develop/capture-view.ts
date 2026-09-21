/**
 * The capture's files as a VIEWER lists them (R6 of
 * `docs/capture-renditions.md`, 2026-09-21): the words on the lightbox's
 * chips, what each one can show, and what the `Develop` verb under the
 * picture carries away.
 *
 * The lightbox writes NOTHING — *"la visionneuse n'écrit aucun choix, c'est
 * juste de la visualisation"*. Looking at the camera's JPEG beside the proxy
 * is looking; the document is exactly as it was when the sheet closes. What
 * carries the choice is the VERB: pressing `Develop` while the ARW is on
 * screen opens the develop on that rendition (`viewedRendition`).
 *
 * Pure and DOM-free: the fetching, the slicing of a RAW's render and the
 * object URLs are `use-capture-view.ts`'s.
 */

import { isRawImage } from '../library/assets';
import type { CaptureInput, PixelSize, Rendition } from '../media/renditions';
import { openingRendition } from '../media/renditions';
import type { WinnowAssetRow } from '../sources/winnow/client';

/**
 * The rows a viewer can put on screen: everything but the SENSOR's. A viewer
 * draws files; developing a sensor plane is the Develop tool's work, and a
 * chip that can only say "open Develop" is a control that disappoints.
 */
export function viewableRenditions(rows: readonly Rendition[]): Rendition[] {
  return rows.filter((r) => r.role !== 'sensor');
}

/** The chip's word — the fidelity chip's own: `Proxy`, else the file's name. */
export function viewLabel(row: Rendition): string {
  return row.role === 'proxy' ? 'Proxy' : row.name;
}

/**
 * The line under the picture while that file is shown: what it is, its
 * pixels where measured, its weight, and whether a click will fetch it.
 */
export function viewFacts(row: Rendition, formatBytes: (n: number) => string): string {
  const parts: string[] = [];
  if (row.role === 'proxy') parts.push('the proxy, where the picture opens');
  else if (row.reach === 'embedded') parts.push('the render the camera wrote inside the RAW');
  else parts.push('the file itself');
  if (row.pixels) parts.push(`${row.pixels.width} × ${row.pixels.height}`);
  if (row.bytes != null) parts.push(formatBytes(row.bytes));
  if (!row.here && row.assetId) parts.push('fetched from its instance on request, held for this session');
  return parts.join(' · ');
}

/**
 * What the `Develop` verb hands to the tool: the rendition being viewed, as
 * the roll stores it — null for the one the picture opens on, which is what
 * the workbench stores for "chose nothing", so a look at the proxy never
 * writes a choice the pill would then draw as one.
 */
export function viewedRendition(rows: readonly Rendition[], viewing: string | null): string | null {
  if (!viewing) return null;
  const row = rows.find((r) => r.id === viewing);
  if (!row || row.blocked) return null;
  return row.id === openingRendition(rows)?.id ? null : row.id;
}

function size(width: number | null | undefined, height: number | null | undefined): PixelSize | null {
  return width && height && width > 0 && height > 0 ? { width, height } : null;
}

/**
 * An instance's ROW as a capture, for the sheet that looks at a day before
 * anything is fetched: the proxy it shows, the primary's own file, and the
 * companion Winnow paired with it — the same three files `materialize` turns
 * into a `MediaOrigin`, so the ids match what the workbench lists once the
 * picture crosses (`delivered:<name>` on both sides).
 *
 * `held` says which of them the session already holds, so the chip does not
 * promise a fetch that will not happen. Nothing is read from a head here: a
 * RAW's render size stays unmeasured until it is looked at.
 */
export function rowCaptureInput(
  row: WinnowAssetRow,
  host: string,
  held: (assetId: string) => boolean,
): CaptureInput {
  const assetId = `${host}/${row.id}`;
  const others = [
    {
      name: row.filename,
      bytes: row.file_size ?? null,
      here: held(assetId),
      assetId,
      ...(isRawImage(row.filename)
        ? { sensor: size(row.width, row.height) }
        : { pixels: size(row.width, row.height) }),
    },
  ];
  const cid = row.companion_id;
  const cname = row.companion_filename;
  const paired =
    cid && cname && (!row.group_kind || row.group_kind === 'raw_jpeg') && (!row.companion_media_type || row.companion_media_type === 'photo');
  if (paired) {
    const companionId = `${host}/${cid}`;
    others.push({
      name: cname,
      bytes: row.companion_file_size ?? null,
      here: held(companionId),
      assetId: companionId,
      ...(isRawImage(cname)
        ? { sensor: size(row.companion_width, row.companion_height) }
        : { pixels: size(row.companion_width, row.companion_height) }),
    });
  }
  return {
    open: { name: row.filename, bytes: null, here: true, assetId },
    openIsProxy: true,
    others,
  };
}
