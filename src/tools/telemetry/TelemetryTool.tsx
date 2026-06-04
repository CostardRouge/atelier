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
      <section className="py-[clamp(2.5rem,7vw,5rem)_0_clamp(2rem,5vw,3rem)] grid grid-cols-1 gap-6 min-[820px]:grid-cols-[1.35fr_1fr] min-[820px]:items-end">
        <div>
          <p className="flex items-center gap-[0.6rem] m-0 mb-4 font-mono text-[0.72rem] uppercase tracking-[0.2em] text-accent-ink before:content-[''] before:w-[26px] before:h-px before:bg-accent">
            Footage, with its memory intact
          </p>
          <h1 className="m-0 font-serif font-normal text-[clamp(2.8rem,8vw,5.2rem)] leading-[0.95] tracking-[-0.02em]">
            Watch your
            <br />
            drone <em className="text-accent italic">think.</em>
          </h1>
        </div>
        <p className="m-0 text-ink-soft text-[1.05rem] leading-[1.6] max-w-[44ch]">
          Every DJI clip carries a hidden flight log — altitude, GPS, ISO,
          shutter — recorded beside it as an{' '}
          <strong className="text-ink font-semibold">.srt</strong> file. Atelier
          plays the two together, so the numbers move with the picture.{' '}
          <strong className="text-ink font-semibold">
            No upload, no account, no server
          </strong>{' '}
          — your footage never leaves this machine.
        </p>
      </section>

      <section
        className="grid grid-cols-1 gap-0 border-t border-b border-line m-0 mb-10 min-[720px]:grid-cols-3"
        aria-label="How it works"
      >
        {STEPS.map((s) => (
          <article
            className="flex flex-col gap-[0.4rem] py-[1.4rem] min-[720px]:p-[1.6rem_1.6rem_1.6rem_0] [&+&]:min-[720px]:pl-[1.6rem] [&+&]:min-[720px]:border-l [&+&]:min-[720px]:border-line"
            key={s.no}
          >
            <span className="font-mono text-[0.7rem] tracking-[0.16em] text-accent">
              {s.no}
            </span>
            <h3 className="m-0 text-base font-semibold">{s.title}</h3>
            <p className="m-0 text-[0.88rem] leading-[1.5] text-muted">
              {s.body}
            </p>
          </article>
        ))}
      </section>

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
          <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3 mb-6">
            <span className="font-serif text-[1.7rem] tracking-[-0.01em]">
              The collection
            </span>
            <p className="m-0 font-mono text-[0.78rem] text-muted tracking-[0.04em]">
              {pairs.length} clip{pairs.length === 1 ? '' : 's'}
            </p>
          </div>
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
