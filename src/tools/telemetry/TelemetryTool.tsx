import { useMemo, useState } from 'react';
import Gallery from './Gallery';
import DetailView from './DetailView';
import { type MediaPair } from './pair-files';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';

const STEPS = [
  {
    no: '01',
    title: 'Add files or a folder',
    body: 'Bring just one .mp4 and its .srt, or a whole DJI card folder, to the Library. Nothing uploads; it stays on your machine.',
  },
  {
    no: '02',
    title: 'Pairs build themselves',
    body: 'Each video finds its matching .srt sibling automatically and starts reading its flight log.',
  },
  {
    no: '03',
    title: 'Telemetry plays inline',
    body: 'Altitude, GPS and exposure move with every clip right in the gallery. Open one full view for the complete readout.',
  },
];

/** Asset kinds the telemetry gallery understands. */
const TELEMETRY_KINDS = ['video+telemetry', 'telemetry', 'video'] as const;

/**
 * Telemetry tool — the original DJI experience: clips play with their flight
 * log synced to the frame. Its clips are a projection of the shared library's
 * selected assets (the `.srt` part is the telemetry); completing or detaching a
 * pair adds/removes the underlying file in the library.
 *
 * The open pair is kept in local state (not a route) on purpose — assets are
 * built from in-memory `File`s, so an id wouldn't survive a reload.
 */
export default function TelemetryTool() {
  const lib = useAssetLibrary();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pairs = useMemo<MediaPair[]>(
    () =>
      selectedUsableAssets(TELEMETRY_KINDS, lib.assets, lib.selection).map(
        (a) => ({
          id: a.id,
          baseName: a.baseName,
          video: a.parts.video ?? null,
          srt: a.parts.srt ?? null,
        }),
      ),
    [lib.assets, lib.selection],
  );

  // Attaching a missing part adds the file to the library (it regroups by base
  // name, completing the pair when the name matches); detaching removes it.
  function handleAttach(_pair: MediaPair, file: File) {
    lib.addFiles([file]);
  }

  function handleDetach(pair: MediaPair, kind: 'video' | 'srt') {
    const file = pair[kind];
    if (file) lib.removeFile(file);
  }

  const selected = pairs.find((p) => p.id === selectedId) ?? null;

  if (selected) {
    return (
      <DetailView
        pair={selected}
        onBack={() => setSelectedId(null)}
        onAttach={handleAttach}
        onDetach={handleDetach}
      />
    );
  }

  return (
    <>
      {pairs.length === 0 ? (
        <p className="m-0 text-[0.92rem] leading-[1.6] text-muted border-[1.5px] border-dashed border-line-strong rounded-paper-lg p-6 bg-surface text-center">
          Add your footage in the{' '}
          <strong className="text-ink-soft font-semibold">Library</strong> on the
          left, then select the clips to read. Videos pair with their{' '}
          <strong className="text-ink-soft font-semibold">.srt</strong> siblings
          automatically.
        </p>
      ) : (
        <section aria-label="Your clips">
          <Gallery
            pairs={pairs}
            onOpen={(p) => setSelectedId(p.id)}
            onAttach={handleAttach}
            onDetach={handleDetach}
          />
        </section>
      )}
    </>
  );
}
