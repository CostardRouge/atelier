import { useMemo, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import DetailView from './DetailView';
import Gallery from './Gallery';
import type { Photo } from './photo';

/** Asset kinds the EXIF viewer understands. */
const PHOTO_KINDS = ['photo'] as const;

/**
 * EXIF viewer — the photo counterpart to the Telemetry tool. Reads camera,
 * lens, exposure and GPS straight out of the photos selected in the shared
 * library, with the same gallery ⇄ detail shape. Only the head of each file is
 * read to parse the metadata; nothing is uploaded.
 *
 * The open photo is local state (not a route) on purpose — assets are built
 * from in-memory `File`s, so an id wouldn't survive a reload.
 */
export default function ExifTool() {
  const lib = useAssetLibrary();
  const [openId, setOpenId] = useState<string | null>(null);

  const photos = useMemo<Photo[]>(
    () =>
      selectedUsableAssets(PHOTO_KINDS, lib.assets, lib.selection)
        .filter((a) => a.parts.image)
        .map((a) => ({
          id: a.id,
          baseName: a.baseName,
          image: a.parts.image as File,
        })),
    [lib.assets, lib.selection],
  );

  const open = photos.find((p) => p.id === openId) ?? null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-[820px]:overflow-visible pb-4">
      {open ? (
        <DetailView photo={open} onBack={() => setOpenId(null)} />
      ) : photos.length === 0 ? (
        <p className="m-0 text-[0.92rem] leading-[1.6] text-muted border-[1.5px] border-dashed border-line-strong rounded-paper-lg p-6 bg-surface text-center">
          Add your photos in the{' '}
          <strong className="text-ink-soft font-semibold">Library</strong> on the
          left, then select the ones to inspect. EXIF is read straight from each
          file — JPEG and most RAW formats carry it, even when the browser can't
          show a preview.
        </p>
      ) : (
        <section aria-label="Your photos">
          <Gallery photos={photos} onOpen={(p) => setOpenId(p.id)} />
        </section>
      )}
    </div>
  );
}
